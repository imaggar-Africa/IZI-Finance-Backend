const Customer = require("../models/customer");
const Loan = require("../models/Loan");
const { sendSMS } = require("../utils/sms");

const PENALTY_RATE = 0.15;

/* ======================================================
   🔁 AUTOMATIC JOB (CRON)
   ====================================================== */
exports.sendDueDateReminders = async () => {
  try {
    console.log("⏰ Running Due & Overdue Reminder Job...");

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const loans = await Loan.find({
      status: "active",
      loanRequestStatus: "approved",
      balance: { $gt: 0 }
    });

    for (const loan of loans) {
      const borrower = await Customer.findById(loan.borrowerId);
      if (!borrower?.phone) continue;

      // 🛑 Avoid sending same reminder twice a day
      if (
        loan.lastReminderSent &&
        new Date(loan.lastReminderSent).toDateString() === today.toDateString()
      ) {
        continue;
      }

      let messageText = "";

      /* 🔔 BEFORE DUE DATE */
      if (loan.dueDate > today) {
        messageText = `Dear ${borrower.fullName},

This is a reminder that your loan balance of KES ${loan.balance}
is due on ${loan.dueDate.toDateString()}.

Please pay on time to avoid penalties.

- IziFinance`;
      }

      /* 🚨 AFTER DUE DATE (LATE PAYMENT NOTICE) */
      else {
        const penalty = Math.round(loan.balance * PENALTY_RATE);
        const totalPayable = loan.balance + penalty;

        messageText = `⚠️ Late Payment Notice ⚠️

Dear ${borrower.fullName},

Your loan was due on ${loan.dueDate.toDateString()} and is now OVERDUE.

Outstanding Balance : KES ${loan.balance}
Late Payment Penalty (15%) : KES ${penalty}

Total Amount Payable : KES ${totalPayable}

Please make payment immediately to avoid further penalties.

- IziFinance`;
      }

      await sendSMS(borrower.phone, messageText);

      loan.lastReminderSent = new Date();
      await loan.save();
    }

    console.log("✅ Due & Overdue Reminder Job Completed");
  } catch (error) {
    console.error("❌ Reminder Job Error:", error);
  }
};


/* ======================================================
   ✋ MANUAL REMINDER (POSTMAN / ADMIN BUTTON)
   ====================================================== */
exports.sendManualReminder = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const loans = await Loan.find({
      status: "active",
      loanRequestStatus: "approved",
      balance: { $gt: 0 }
    });

    let sent = 0;
    const messages = [];

    for (const loan of loans) {
      const borrower = await Customer.findById(loan.borrowerId);
      if (!borrower?.phone) continue;

      let messageType = "";
      let messageText = "";

      /* 🔔 BEFORE DUE DATE */
      if (loan.dueDate > today) {
        messageType = "PRE_DUE";

        messageText = `Dear ${borrower.fullName},

Your loan balance of KES ${loan.balance}
is due on ${loan.dueDate.toDateString()}.

Please pay before due date to avoid penalties.

- IziFinance`;
      }

      /* 🚨 AFTER DUE DATE (LATE PAYMENT NOTICE) */
      else {
        const penalty = Math.round(loan.balance * PENALTY_RATE);
        const totalPayable = loan.balance + penalty;

        messageType = "OVERDUE_LATE_PAYMENT";

        messageText = `⚠️ Late Payment Notice ⚠️

Dear ${borrower.fullName},

Your loan was due on ${loan.dueDate.toDateString()} and is now OVERDUE.

Outstanding Balance : KES ${loan.balance}
Late Payment Penalty (15%) : KES ${penalty}

Total Amount Payable : KES ${totalPayable}

Please make payment immediately.

- IziFinance`;
      }

      await sendSMS(borrower.phone, messageText);
      sent++;

      messages.push({
        loanId: loan._id,
        borrowerName: borrower.fullName,
        phone: borrower.phone,
        dueDate: loan.dueDate,
        type: messageType,
        message: messageText
      });
    }

    return res.json({
      success: true,
      sent,
      messages
    });

  } catch (error) {
    console.error("❌ Manual Reminder Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


/* ======================================================
   📩 MANUAL REMINDER – BY BORROWER ID
   ====================================================== */
/* ======================================================
   📩 MANUAL REMINDER – BY borrowerId + loanId
   ====================================================== */
exports.sendReminderByBorrowerAndLoan = async (req, res) => {
  try {
    const { borrowerId, loanId } = req.params;

    if (!borrowerId || !loanId) {
      return res.status(400).json({
        success: false,
        message: "borrowerId and loanId are required"
      });
    }

    /* ================= BORROWER ================= */
    const borrower = await Customer.findById(borrowerId);
    if (!borrower || !borrower.phone) {
      return res.status(404).json({
        success: false,
        message: "Borrower not found or phone missing"
      });
    }

    /* ================= LOAN ================= */
    const loan = await Loan.findOne({
      _id: loanId,
      borrowerId,
    status: { $in: ["active", "overdue"] },
      loanRequestStatus: "approved",
      balance: { $gt: 0 }
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: "Active loan not found for this borrower"
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let messageType = "";
    let messageText = "";

    /* 🔔 BEFORE DUE DATE */
    if (loan.dueDate > today) {
      messageType = "PRE_DUE";

      messageText = `Dear ${borrower.fullName},

This is a reminder that your loan balance of KES ${loan.balance}
is due on ${loan.dueDate.toDateString()}.

Please pay on time to avoid penalties.

- IziFinance`;
    }

    /* 🚨 AFTER DUE DATE */
    else {
      const penalty = Math.round(loan.balance * PENALTY_RATE);
      const totalPayable = loan.balance + penalty;

      messageType = "OVERDUE";

      messageText = ` Late Payment Notice 

Dear ${borrower.fullName},

Your loan was due on ${loan.dueDate.toDateString()} and is now OVERDUE.

Outstanding Balance : KES ${loan.balance}
Late Payment Penalty (15%) : KES ${penalty}

Total Amount Payable : KES ${totalPayable}

Please make payment immediately.

- IziFinance`;
    }

    await sendSMS(borrower.phone, messageText);

    return res.json({
      success: true,
      message: "Reminder sent successfully",
      data: {
        borrowerId: borrower._id,
        borrowerName: borrower.fullName,
        phone: borrower.phone,
        loanId: loan._id,
        balance: loan.balance,
        dueDate: loan.dueDate,
        type: messageType,
         smsMessage: messageText 
      }
    });

  } catch (error) {
    console.error("❌ Reminder Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};




