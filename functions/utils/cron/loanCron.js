const Loan = require("../../models/Loan");
const { sendSMS } = require("../../utils/sms");
const { normalizePhone } = require("../../utils/normalizePhone");
const { applyScoreRecovery } = require("../creditScore");
const Customer = require("../../models/customer");
const Transaction = require("../../models/Transaction");


// ⏰ Runs every day at 6 AM and 6 PM (Kenya/Nairobi time)
async function checkLoansAndSendReminders(specificLoanId = null) {
  const startTime = Date.now();
  console.log(
    `⏰ [LOAN_REMINDER_CRON_LOGIC] Started at ${new Date().toISOString()} (Nairobi: ${new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })})`
  );

  try {
    const filter = {
      status: { $in: ["active", "overdue"] },
      balance: { $gt: 0 },
    };
    if (specificLoanId) {
      filter._id = specificLoanId;
    }
    const loans = await Loan.find(filter).populate("borrowerId lenderId");

    console.log(`[LOAN_REMINDER_CRON_LOGIC] Found ${loans.length} active/overdue loans with positive balance.`);

    let overdueCount = 0;
    let smsSentCount = 0;

    for (const loan of loans) {
      const now = new Date();

      // Apply initial overdue penalty if needed
      const overdueApplied = await applyOverduePenaltyIfNeeded(loan);
      if (overdueApplied) {
        overdueCount++;
      }

      // Apply monthly penalty if needed
      await applyMonthlyPenaltyIfNeeded(loan);

      // =====================================================
      // DAILY SMS REMINDER
      // =====================================================
      const rawPhone = loan.borrowerId?.phone || loan.borrowerId?.phoneNumber || loan.phoneNumber;
      const borrowerPhone = normalizePhone(rawPhone);

      if (!borrowerPhone) {
        console.warn("[LOAN_REMINDER_CRON_LOGIC] ⚠️ Invalid borrower phone. Skipping SMS for loan:", loan._id);
        continue;
      }

      const lastReminder = loan.lastReminderSentAt || loan.lastReminderSent;
      // 20-hour window prevents Cloud Scheduler jitter from skipping daily reminders
      const shouldSendReminder =
        !lastReminder ||
        now - new Date(lastReminder) >= 20 * 60 * 60 * 1000;

      if (shouldSendReminder) {
        try {
          const borrowerName = loan.borrowerId?.fullName || loan.fullName || "Valued Customer";
          const dueDateFormatted = loan.dueDate ? new Date(loan.dueDate).toDateString() : "the due date";
          const messageText =
            loan.status === "overdue"
              ? `IziFinance Late Payment Notice\nHello ${borrowerName}, your loan is overdue.\nAmount Due: KES ${loan.balance}.\n\nPlease pay immediately.`
              : `IziFinance Reminder\nHello ${borrowerName}, your loan of KES ${loan.balance} is due on ${dueDateFormatted}.\nPlease repay on time to avoid penalties.`;

          await sendSMS(borrowerPhone, messageText);
          smsSentCount++;

          loan.lastReminderSentAt = now;
          loan.lastReminderSent = now;
          await loan.save();
          console.log(`[LOAN_REMINDER_CRON_LOGIC] 📤 Reminder queued for loan ${loan._id} to ${borrowerPhone}`);
        } catch (err) {
          console.error("[LOAN_REMINDER_CRON_LOGIC] SMS sending failed for loan:", loan._id, err.message);
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `✅ [LOAN_REMINDER_CRON_LOGIC] Completed in ${duration}ms. Marked/Updated Overdue: ${overdueCount}, SMS Sent: ${smsSentCount}`
    );
  } catch (error) {
    console.error(`❌ [LOAN_REMINDER_CRON_LOGIC] Failed after ${Date.now() - startTime}ms:`, error.message);
  }
}

/* ======================================================
   ⭐ SCORE RECOVERY CRON
   Runs every day at Midnight
====================================================== */
async function runScoreRecovery() {
  const startTime = Date.now();
  console.log(
    `⏰ [SCORE_RECOVERY_CRON_LOGIC] Started at ${new Date().toISOString()} (Nairobi: ${new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })})`
  );

  try {
    const customers = await Customer.find({ isDeleted: false });
    console.log(`[SCORE_RECOVERY_CRON_LOGIC] Found ${customers.length} non-deleted customers to check.`);

    let processedCount = 0;
    for (const customer of customers) {
      await applyScoreRecovery(customer);
      processedCount++;
    }

    const duration = Date.now() - startTime;
    console.log(`✅ [SCORE_RECOVERY_CRON_LOGIC] Completed in ${duration}ms. Processed customers: ${processedCount}`);
  } catch (err) {
    console.error(`❌ [SCORE_RECOVERY_CRON_LOGIC] Failed after ${Date.now() - startTime}ms:`, err);
  }
}

// ⏰ Local development scheduling using node-cron
function initLocalCron() {
  const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
  if (!isEmulator && !process.env.FIREBASE_CONFIG) {
    const cron = require("node-cron");
    
    cron.schedule(
      "0 18 * * *",
      checkLoansAndSendReminders,
      {
        timezone: "Africa/Nairobi",
      }
    );

    cron.schedule(
      "0 0 1 * *",
      runScoreRecovery,
      {
        timezone: "Africa/Nairobi",
      }
    );
    console.log("⏰ Local Loan Cron Jobs Scheduled");
  } else {
    console.log("ℹ️ Skipping local cron initialization in emulator environment");
  }
}

async function applyOverduePenaltyIfNeeded(loan) {
  const now = new Date();
  const dueDate = new Date(loan.dueDate);

  if (
    (loan.status === "active" || loan.status === "overdue") &&
    dueDate <= now &&
    !loan.penaltyApplied
  ) {
    const originalPrincipal = loan.amount || 0;
    const penalty = Math.round(originalPrincipal * 0.15);

    loan.status = "overdue";
    loan.balance += penalty;
    loan.penaltyAmount = (loan.penaltyAmount || 0) + penalty;

    loan.penaltyApplied = true;
    loan.penaltyAppliedAt = now;
    loan.lastMonthlyPenaltyAt = now;

    await loan.save();

    const rawPhone = loan.borrowerId?.phone || loan.borrowerId?.phoneNumber;
    const borrowerPhone = normalizePhone(rawPhone) || "";

    await Transaction.create({
      type: "penalty",
      userId: loan.borrowerId?._id || loan.borrowerId,
      userModel: "Customer",
      loanId: loan._id,
      amount: penalty,
      phone: borrowerPhone,
      description: "Initial overdue penalty (15%)",
      status: "successful",
    });

    console.log(
      `⚠️ [LOAN_REMINDER_CRON_LOGIC] Loan ${loan._id} initial penalty of KES ${penalty} added.`
    );
    return true;
  }
  return false;
}

async function applyMonthlyPenaltyIfNeeded(loan) {
  const now = new Date();
  const remainingPrincipal = Math.max(
    0,
    loan.amount - (loan.principalPaid || 0)
  );

  if (
    loan.status === "overdue" &&
    remainingPrincipal > 0 &&
    loan.lastMonthlyPenaltyAt
  ) {
    const lastPenalty = new Date(loan.lastMonthlyPenaltyAt);

    const nextPenaltyDate = new Date(lastPenalty);
    nextPenaltyDate.setMonth(nextPenaltyDate.getMonth() + 1);

    if (now >= nextPenaltyDate) {
      const monthlyPenalty = Math.round(remainingPrincipal * 0.15);

      loan.balance += monthlyPenalty;
      loan.penaltyAmount = (loan.penaltyAmount || 0) + monthlyPenalty;
      loan.lastMonthlyPenaltyAt = now;

      await loan.save();

      const rawPhone = loan.borrowerId?.phone || loan.borrowerId?.phoneNumber;
      const borrowerPhone = normalizePhone(rawPhone) || "";

      await Transaction.create({
        type: "monthly_penalty",
        userId: loan.borrowerId?._id || loan.borrowerId,
        userModel: "Customer",
        loanId: loan._id,
        amount: monthlyPenalty,
        phone: borrowerPhone,
        description: "Monthly overdue penalty (15%)",
        status: "successful",
      });

      console.log(
        `⚠️ [LOAN_REMINDER_CRON_LOGIC] Loan ${loan._id} monthly penalty of KES ${monthlyPenalty} added.`
      );
      return true;
    }
  }
  return false;
}

module.exports = {
  checkLoansAndSendReminders,
  runScoreRecovery,
  initLocalCron,
  applyOverduePenaltyIfNeeded,
  applyMonthlyPenaltyIfNeeded,
};




