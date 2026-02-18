const Loan = require("../models/Loan");
const mongoose = require("mongoose");
const Customer = require("../models/customer");
const Transaction = require("../models/Transaction");
const { initiateB2C, initiateSTKPush } = require("../utils/mpesa");
const { sendSMS } = require("../utils/sms");
const User = require("../models/User");
const asyncHandler = require("express-async-handler");
const { normalizePhone } = require("../utils/phone");
const Notification = require("../models/Notification");
const AgentModel = require("../models/AgentModel");
const AgentCommission = require("../models/AgentCommission");
const { evaluateLoanByCreditScore } = require("../utils/loanApprovalRules");

/* =====================================================
   🔢 LOAN CALCULATION HELPER (USED FOR REPAYMENT BEHAVIOR)
   ❗ DO NOT CHANGE FORMULA
===================================================== */
function calculateLoan(principal, repaymentDays, totalPaid = 0) {
  const INTEREST_RATE = 0.35;

  const interest = principal * INTEREST_RATE;
  const totalPayable = principal + interest;

  const dailyTarget = totalPayable / repaymentDays;

  const remainingBalance = Math.max(totalPayable - totalPaid, 0);

  const remainingDays =
    dailyTarget > 0
      ? Math.ceil(remainingBalance / dailyTarget)
      : 0;

  return {
    principal,
    interest,
    totalPayable,
    repaymentDays,
    dailyTarget: Math.round(dailyTarget),
    totalPaid,
    remainingBalance,
    remainingDays
  };
}



/* =====================================================
   1️⃣ TRACK LOAN REPAYMENT (STK PUSH INIT)
   ✔ Live: waits for Safaricom callback
   ✔ Sandbox: auto-triggers callback
===================================================== */
exports.trackRepayment = async (req, res) => {
  try {
    const borrowerId = req.borrower._id;
    const { loanId, amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Amount is required and must be greater than zero" });
    }

    // Find borrower
    const borrower = await Customer.findById(borrowerId);
    if (!borrower) {
      return res.status(404).json({ message: "Borrower not found" });
    }

    // Find active loan
    const loan = await Loan.findOne({
      _id: loanId,
      borrowerId,
      status: { $ne: "fully paid" }
    });

    if (!loan) {
      return res.status(404).json({ message: "Loan not found or already fully repaid" });
    }

    // Normalize phone — preparing for STK push
    const rawPhone = borrower.phone || borrower.phoneNumber;
    const customerPhone = normalizePhone(rawPhone, "KE");

    if (!customerPhone) {
      return res.status(400).json({ message: "Invalid phone number" });
    }

    // Prevent overpayment
    if (amount > loan.balance) {
      return res.status(400).json({
        message: `Repayment exceeds balance. Remaining balance: KES ${loan.balance}.`
      });
    }

    // Create reference for MPESA statement
    const accountRef = `${borrower.fullName}-${borrower.idNumber}-${borrower.phone}-Loan-${loan._id}`;

    // Create pending transaction
    const transaction = new Transaction({
      type: "repayment",
      userId: borrowerId,
      userModel: "Customer",
      loanId: loan._id,
      clientId: loan.clientId,
      phone: customerPhone,
      amount,
      accountReference: accountRef,
      balanceBefore: loan.balance,
      balanceAfter: loan.balance,
      status: "pending"
    });

    await transaction.save();

    /* -------------------------------------------------------
       LIVE MODE ONLY - Always STK — callback will finalize
    ------------------------------------------------------- */

    const stkResponse = await initiateSTKPush(customerPhone, amount, accountRef);

    // Save CheckoutRequestID for callback matching
    transaction.checkoutRequestID = stkResponse.CheckoutRequestID;
    await transaction.save();

    return res.status(200).json({
      message: "Repayment initiated. Complete the payment on your phone.",
      stkResponse,
      transaction
    });

  } catch (error) {
    console.error("❌ Error tracking repayment:", error);
    return res.status(500).json({ message: error.message });
  }
};

/* =====================================================
   2️⃣ ISSUE LOAN (DIRECT LENDER)
===================================================== */
// exports.issueLoan = async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const lenderId = req.user._id;
//     const {
//       borrowerId,
//       amount,
//       totalInterest,
//       duration,
//       repaymentFrequency,
//       phoneNumber
//     } = req.body;

//     /* ---------------- VALIDATION ---------------- */
//     if (!borrowerId || !amount || !totalInterest || !duration || !repaymentFrequency || !phoneNumber) {
//       throw new Error("All fields are required");
//     }

//     /* ---------------- LENDER ---------------- */
//     const lender = await User.findById(lenderId).session(session);
//     if (!lender) throw new Error("Lender not found");
//     if (lender.walletBalance < amount) {
//       throw new Error("Insufficient wallet balance");
//     }

//     /* ---------------- BORROWER ---------------- */
//     const borrower = await Customer.findById(borrowerId).session(session);
//     if (!borrower) throw new Error("Borrower not found");

//     if (borrower.isDeleted) throw new Error("Borrower account is inactive");
//     if (!borrower.isVerified) throw new Error("Borrower is not verified");

//     /* ---------------- CREDIT CHECK ---------------- */
//     const eligibility = evaluateLoanByCreditScore({
//       creditScore: borrower.creditScore || 500,
//       requestedAmount: amount,
//       borrower
//     });

//     if (!eligibility.allowed || amount > eligibility.approvedAmount) {
//       throw new Error(
//         `Loan not allowed. Max eligible amount: ${eligibility.approvedAmount}`
//       );
//     }

//     /* ---------------- EXISTING LOAN CHECK ---------------- */
//     const existingLoan = await Loan.findOne({
//       borrowerId,
//       status: { $in: ["pending", "active", "overdue"] },
//       loanRequestStatus: { $ne: "rejected" }
//     }).session(session);

//     if (existingLoan) {
//       throw new Error("Borrower already has an existing loan");
//     }

//     /* ---------------- CALCULATIONS ---------------- */
//     const totalRepayment = Number(amount) + Number(totalInterest);
//     const dailyRepayment =
//       totalRepayment /
//       (duration *
//         (repaymentFrequency === "weekly"
//           ? 7
//           : repaymentFrequency === "monthly"
//           ? 30
//           : 1));

//     /* ---------------- CREATE LOAN ---------------- */
//    const [loan] = await Loan.create(
//   [
//     {
//       lenderId,
//       borrowerId,

//       billRefNumber: borrower.idNumber, // ✅ REQUIRED
//       requestedByAgentId: null,         // ✅ because lender direct

//       clientId: borrower.idNumber,
//       fullName: borrower.fullName,
//       phoneNumber,
//       lenderPhone: lender.phone,

//       amount,
//       interest: totalInterest,
//       totalRepayment,
//       balance: totalRepayment,
//       dailyRepayment,
//       duration,

//       issueDate: new Date(),
//       dueDate: new Date(Date.now() + duration * 86400000),

//       status: "pending",
//       loanRequestStatus: "approved",

//       repaidAmount: 0,
//       repayments: []
//     }
//   ],
//   { session }
// );


//     /* ---------------- CREATE PENDING TRANSACTION ---------------- */
//     const [transaction] = await Transaction.create(
//       [
//         {
//           userId: lenderId,
//           userModel: "User",
//           loanId: loan._id,
//           type: "loan issued",
//           amount,
//           status: "pending",
//           phone: phoneNumber,
//           description: "Loan disbursement",

//           // ✅ wallet not touched yet
//           balanceBefore: lender.walletBalance,
//           balanceAfter: lender.walletBalance
//         }
//       ],
//       { session }
//     );

//     /* =====================================================
//        🧪 SANDBOX MODE (NO CALLBACK COMES)
//     ===================================================== */
//     if (global.config.mpesaEnv === "sandbox") {
//       transaction.status = "successful";
//       loan.status = "active";

//       lender.walletBalance -= amount;

//       await lender.save({ session });
//       await loan.save({ session });
//       await transaction.save({ session });

//       await session.commitTransaction();
//       session.endSession();

//       return res.status(201).json({
//         success: true,
//         message: "Loan issued successfully (sandbox mode)",
//         loan,
//         transaction
//       });
//     }

//     /* =====================================================
//        🚀 LIVE MODE (WAIT FOR STK CALLBACK)
//     ===================================================== */
//     const b2cResponse = await initiateB2C(
//       phoneNumber,
//       amount,
//       transaction._id
//     );

//     if (b2cResponse?.OriginatorConversationID) {
//       transaction.checkoutRequestID = b2cResponse.OriginatorConversationID;
//       await transaction.save({ session });
//     }

//     await session.commitTransaction();
//     session.endSession();

//     return res.status(201).json({
//       success: true,
//       message: "Loan initiated. Awaiting M-Pesa confirmation",
//       loan,
//       transaction
//     });

//   } catch (error) {
//     if (session.inTransaction()) await session.abortTransaction();
//     session.endSession();

//     console.error("❌ issueLoan error:", error);
//     return res.status(500).json({ message: error.message });
//   }
// };


exports.issueLoan = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const lenderId = req.user._id;

    const {
      borrowerId,
      amount,
      totalInterest,
      duration,
      repaymentFrequency,
      phoneNumber,
      agentId // ✅ NEW (optional)
    } = req.body;

    /* ---------------- VALIDATION ---------------- */
    if (
      !borrowerId ||
      !amount ||
      !totalInterest ||
      !duration ||
      !repaymentFrequency ||
      !phoneNumber
    ) {
      throw new Error("All fields are required");
    }

    /* ---------------- LENDER ---------------- */
    const lender = await User.findById(lenderId).session(session);
    if (!lender) throw new Error("Lender not found");

    if (lender.walletBalance < amount) {
      throw new Error("Insufficient wallet balance");
    }

    /* ---------------- BORROWER ---------------- */
    const borrower = await Customer.findById(borrowerId).session(session);
    if (!borrower) throw new Error("Borrower not found");

    if (borrower.isDeleted) throw new Error("Borrower account is inactive");
    if (!borrower.isVerified) throw new Error("Borrower is not verified");

    /* ---------------- CREDIT CHECK ---------------- */
    const eligibility = evaluateLoanByCreditScore({
      creditScore: borrower.creditScore || 500,
      requestedAmount: amount,
      borrower
    });

    if (!eligibility.allowed || amount > eligibility.approvedAmount) {
      throw new Error(
        `Loan not allowed. Max eligible amount: ${eligibility.approvedAmount}`
      );
    }

    /* ---------------- EXISTING LOAN CHECK ---------------- */
    const existingLoan = await Loan.findOne({
      borrowerId,
      status: { $in: ["pending", "active", "overdue"] },
      loanRequestStatus: { $ne: "rejected" }
    }).session(session);

    if (existingLoan) {
      throw new Error("Borrower already has an existing loan");
    }

    /* ---------------- CALCULATIONS ---------------- */
    const totalRepayment = Number(amount) + Number(totalInterest);

    const dailyRepayment =
      totalRepayment /
      (duration *
        (repaymentFrequency === "weekly"
          ? 7
          : repaymentFrequency === "monthly"
          ? 30
          : 1));

    /* ---------------- CREATE LOAN ---------------- */

    const [loan] = await Loan.create(
      [
        {
          lenderId,
          issuedByLenderId: lenderId, // ✅ Lender approved
          requestedByAgentId: agentId || null, // ✅ Agent if exists

          borrowerId,
          billRefNumber: borrower.idNumber, // ✅ REQUIRED

          clientId: borrower.idNumber,
          fullName: borrower.fullName,
          phoneNumber,
          lenderPhone: lender.phone,

          amount,
          interest: totalInterest,
          repaymentPlan: repaymentFrequency,
          totalRepayment,
          balance: totalRepayment,
          dailyRepayment,
          duration,

          issueDate: new Date(),
          dueDate: new Date(Date.now() + duration * 86400000),

          status: "pending", // will become active after B2C success
          loanRequestStatus: "approved",

          repaidAmount: 0,
          repayments: []
        }
      ],
      { session }
    );

    /* ---------------- CREATE PENDING TRANSACTION ---------------- */

    const [transaction] = await Transaction.create(
      [
        {
          userId: lenderId,
          userModel: "User",
          loanId: loan._id,
          type: "loan issued",
          amount,
          status: "pending",
          phone: phoneNumber,

          balanceBefore: lender.walletBalance,
          balanceAfter: lender.walletBalance
        }
      ],
      { session }
    );

    /* ================= SANDBOX MODE ================= */

    if (global.config.mpesaEnv === "sandbox") {
      transaction.status = "successful";
      loan.status = "active";

      lender.walletBalance -= amount;

      await lender.save({ session });
      await loan.save({ session });
      await transaction.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.status(201).json({
        success: true,
        message: "Loan issued successfully (sandbox mode)",
        loan,
        transaction
      });
    }

    /* ================= LIVE MODE ================= */

    const b2cResponse = await initiateB2C(
      phoneNumber,
      amount,
      transaction._id
    );

    if (b2cResponse?.OriginatorConversationID) {
      transaction.checkoutRequestID =
        b2cResponse.OriginatorConversationID;
      await transaction.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      success: true,
      message: "Loan initiated. Awaiting M-Pesa confirmation",
      loan,
      transaction
    });

  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();

    console.error("❌ issueLoan error:", error);
    return res.status(500).json({ message: error.message });
  }
};



/* =====================================================
   3️⃣ GET ACTIVE LOANS BY PHONE
===================================================== */
exports.getActiveLoansByPhone = async (req, res) => {
  try {
    const borrower = req.borrower;

    const loans = await Loan.find({
      borrowerId: borrower._id,
      status: { $ne: "fully paid" }
    }).sort({ dueDate: 1 });

    res.json({
      success: true,
      borrower,
      loans
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

/* =====================================================
   4️⃣ GET FULLY PAID LOANS
===================================================== */
exports.getFullyPaidLoans = async (req, res) => {
  const loans = await Loan.find({
    loanRequestStatus: "approved",
    status: "fully paid"
  }).populate("borrowerId");

  res.status(200).json({ loans });
};

/* =====================================================
   5️⃣ GET FULLY PAID LOANS BY CUSTOMER
===================================================== */
exports.getFullyPaidLoansByCustomer = async (req, res) => {
  const { borrowerId } = req.params;

  const loans = await Loan.find({
    borrowerId,
    status: "fully paid"
  });

  res.status(200).json({ loans });
};

/* =====================================================
   6️⃣ GET OUTSTANDING LOANS (ACTIVE + OVERDUE + RISK)
===================================================== */
exports.getOutstandingLoans = async (req, res) => {
  try {
    const today = new Date();

    const loans = await Loan.find({
      loanRequestStatus: "approved",
      status: { $in: ["active", "overdue"] }
    }).populate("borrowerId");

    const enrichedLoans = loans.map((loan) => {
      const dueDate = new Date(loan.dueDate);
      const issueDate = new Date(loan.issueDate);

      // days calculations
      const daysToDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
      const daysOverdue =
        today > dueDate
          ? Math.ceil((today - dueDate) / (1000 * 60 * 60 * 24))
          : 0;

      // expected repayment till today
      const totalDays =
        Math.ceil((dueDate - issueDate) / (1000 * 60 * 60 * 24)) || 1;

      const daysElapsed =
        Math.ceil((today - issueDate) / (1000 * 60 * 60 * 24)) || 1;

      const expectedPaid =
        (loan.totalRepayment / totalDays) * Math.min(daysElapsed, totalDays);

      const repaymentRatio =
        loan.repaidAmount / Math.max(expectedPaid, 1);

      /* ===============================
         STATUS + RISK LOGIC
      =============================== */
      let badge = "ON_TRACK";
      let color = "green";
      let label = "On Track";
      let riskLevel = "LOW";

      if (daysOverdue > 0) {
        badge = "OVERDUE";
        color = "red";
        label = "Overdue";
        riskLevel = "HIGH";
      } else if (daysToDue <= 3 || repaymentRatio < 0.8) {
        badge = "AT_RISK";
        color = "amber";
        label = "At Risk";
        riskLevel = "MEDIUM";
      }

      return {
        ...loan.toObject(),
        riskLevel,
        loanStatus: {
          badge,
          color,
          label,
          daysToDue: daysToDue > 0 ? daysToDue : 0,
          daysOverdue,
          repaymentRatio: Number(repaymentRatio.toFixed(2))
        }
      };
    });

    res.status(200).json({
      success: true,
      loans: enrichedLoans
    });
  } catch (error) {
    console.error("❌ getOutstandingLoans error:", error);
    res.status(500).json({ message: "Server error" });
  }
};



/* =====================================================
   7️⃣ GET BORROWERS WITH LOANS (DASHBOARD)
===================================================== */
exports.getBorrowersWithLoans = async (req, res) => {
  try {
    const loans = await Loan.find({
      status: "active",
      loanRequestStatus: "approved"
    }).populate("borrowerId");

    const borrowerMap = {};

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const today = new Date();

    let totalLoanAmount = 0;        // principal + interest
    let totalCollectedAmount = 0;   // actual collected
    let totalActiveLoanCount = 0;
    let totalOverdueLoanCount = 0;
    let totalBalance = 0;           // ✅ ADDED

    const paidToday = [];
    const notPaidToday = [];

    loans.forEach((loan) => {
      const borrowerId = loan.borrowerId._id.toString();

      if (!borrowerMap[borrowerId]) {
        borrowerMap[borrowerId] = {
          borrower: loan.borrowerId,
          loanCount: 0,
          loans: []
        };
      }

      borrowerMap[borrowerId].loanCount++;
      totalActiveLoanCount++;

      /* ================= TOTAL LOAN AMOUNT ================= */
      totalLoanAmount += loan.totalRepayment || 0;

      /* ================= TOTAL COLLECTED ================= */
      const collectedFromRepayments = Array.isArray(loan.repayments)
        ? loan.repayments.reduce((sum, r) => sum + (r.amount || 0), 0)
        : 0;

      totalCollectedAmount += collectedFromRepayments;

      /* ================= TOTAL BALANCE ================= */
      totalBalance += loan.balance || 0;   // ✅ ADDED

      /* ---------------- LAST PAYMENT ---------------- */
      let lastPaymentDate = null;
      let paidTodayFlag = false;

      if (loan.repayments?.length) {
        const lastPayment = [...loan.repayments].sort(
          (a, b) => new Date(b.date) - new Date(a.date)
        )[0];

        lastPaymentDate = lastPayment.date;

        paidTodayFlag =
          new Date(lastPayment.date) >= startOfToday &&
          new Date(lastPayment.date) <= endOfToday;
      }

      /* ---------------- EXPECTED DAILY AMOUNT ---------------- */
      const expectedDailyAmount = loan.dailyRepayment || 0;

      /* ---------------- OVERDUE LOGIC ---------------- */
      const isOverdue =
        loan.balance > 0 && new Date(loan.dueDate) < today;

      if (isOverdue) {
        totalOverdueLoanCount++;
      }

      /* ---------------- STATUS BADGE ---------------- */
      let statusBadge = "On Track";

      if (isOverdue) {
        statusBadge = "Overdue";
      } else if (!paidTodayFlag) {
        statusBadge = "At Risk";
      }

      /* ---------------- ENRICH LOAN ---------------- */
      const enrichedLoan = {
        ...loan.toObject(),
        expectedDailyAmount,
        lastPaymentDate,
        paidToday: paidTodayFlag,
        statusBadge,
        collectedAmount: collectedFromRepayments
      };

      borrowerMap[borrowerId].loans.push(enrichedLoan);

      /* ---------------- TAB DATA ---------------- */
      const tabRow = {
        borrowerName: loan.borrowerId.fullName,
        loanId: loan._id,
        expectedDailyAmount,
        lastPaymentDate,
        statusBadge
      };

      if (paidTodayFlag) {
        paidToday.push(tabRow);
      } else {
        notPaidToday.push(tabRow);
      }
    });

    res.status(200).json({
      success: true,
      totalBorrowers: Object.keys(borrowerMap).length,
      summary: {
        totalLoanAmount,
        totalCollectedAmount,
        totalBalance,          // ✅ ADDED
        totalActiveLoanCount,
        totalOverdueLoanCount
      },
      data: Object.values(borrowerMap),
      tabs: {
        paidToday,
        notPaidToday
      }
    });
  } catch (error) {
    console.error("Error fetching borrowers with loans:", error);
    res.status(500).json({ message: "Server error" });
  }
};


/* =====================================================
   8️⃣ GET LOANS BY BORROWER
===================================================== */
exports.getLoansByBorrower = async (req, res) => {
  const { borrowerId } = req.params;

  const loans = await Loan.find({
    borrowerId,
    loanRequestStatus: "approved",
    status: { $in: ["active", "overdue"] }
  });

  const enrichedLoans = loans.map((loan) => {
    const repayments = Array.isArray(loan.repayments) ? loan.repayments : [];

    const totalPaid = repayments.reduce(
      (sum, r) => sum + (r.amount || 0),
      0
    );

    const paymentsMade = repayments.length;

    const averagePayment =
      paymentsMade > 0 ? Math.round(totalPaid / paymentsMade) : 0;

    const lastPayment =
      paymentsMade > 0
        ? repayments.sort((a, b) => new Date(b.date) - new Date(a.date))[0]
        : null;

    // ✅ EXISTING: repayment behavior calculation
    const repaymentBehavior = calculateLoan(
      loan.amount,      // principal
      loan.duration,    // repaymentDays
      totalPaid
    );

    const repaymentProgress =
      repaymentBehavior.totalPayable > 0
        ? Math.round(
            (totalPaid / repaymentBehavior.totalPayable) * 100
          )
        : 0;

    // ✅ ADDED: loan eligibility (NO EXISTING CODE CHANGED)
    const eligibility = evaluateLoanByCreditScore({
      creditScore: loan.creditScoreAfter || 500,
      requestedAmount: loan.amount,
      borrower: loan.borrowerId
    });

    return {
      ...loan.toObject(),

      // ================= EXISTING =================
      repaymentBehavior: {
        paymentsMade,
        averagePayment,
        totalPaid,
        remainingBalance: repaymentBehavior.remainingBalance,
        remainingPayments: repaymentBehavior.remainingDays,
        dailyTarget: repaymentBehavior.dailyTarget,
        lastPaymentDate: lastPayment?.date || null,
        repaymentProgress
      },

      // ================= ADDED (SAFE) =================
      loanEligibility: {
        eligible: eligibility.allowed,
        creditScore: loan.creditScoreAfter || 500,
        maxEligibleAmount: eligibility.approvedAmount || 0,
        reason: eligibility.reason || null
      }
    };
  });

  res.json({ loans: enrichedLoans });
};



/* =====================================================
   9️⃣ AGENT → REQUEST LOAN
===================================================== */
exports.requestLoan = async (req, res) => {
  try {
    const agentId = req.user._id;
    const { borrowerId, amount, totalInterest, duration, repaymentFrequency} = req.body;

    // ✅ Validation
    if (!borrowerId || !amount || !totalInterest || !duration || !repaymentFrequency ) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // ✅ Check borrower existence
    const borrower = await Customer.findById(borrowerId);
    if (!borrower) return res.status(404).json({ message: "Borrower not found" });

    // ✅ Fetch Agent and its assigned Lender
    const agent = await AgentModel.findById(agentId);
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    const lender = await User.findById(agent.lenderId);
    if (!lender) return res.status(404).json({ message: "Assigned lender not found" });

    // ✅ Check if borrower already has active, pending, or overdue loan
    const existingLoan = await Loan.findOne({
      borrowerId,
      status: { $in: [ "active", "overdue"] }
    })
      .populate("requestedByAgentId", "name phone")
      .populate("lenderId", "name phone")
      .populate("borrowerId", "fullName phone email");

    if (existingLoan) {
      return res.status(400).json({
        message: `This borrower already has an existing ${existingLoan.status} loan.`,
        existingLoan
      });
    }

    // ✅ Calculate repayment details
    const totalRepayment = parseFloat(amount) + parseFloat(totalInterest);
    const dailyRepayment = totalRepayment / duration;

    // ✅ Create new loan request
    const loan = await Loan.create({
      lenderId: lender._id,
      borrowerId,
      requestedByAgentId: agentId,
      fullName: borrower.fullName,
       phoneNumber: borrower.phone, // ✅ fetched directly,
      lenderPhone: lender.phone,
      amount,
      interest: totalInterest,
      billRefNumber: borrower.idNumber,
      totalRepayment,
      dailyRepayment,
      duration,
      dueDate: new Date(Date.now() + duration * 24 * 60 * 60 * 1000),
      status: "pending",
      loanRequestStatus: "pending"
    });

    // ✅ Create notifications with phone numbers included
    const notifications = [
      {
        userId: agent._id,
        userModel: "Agent",
        title: "Loan Request Created",
        message: `Loan request for ${borrower.fullName} (${borrower.phone}) of KES ${amount} submitted successfully.`,
        phone: agent.phone || "N/A",
        type: "loan",
      },
      {
        userId: lender._id,
        userModel: "User",
        title: "New Loan Request",
        message: `Agent ${agent.name} (${agent.phone}) submitted a loan request for ${borrower.fullName} (${borrower.phone}) of KES ${amount}.`,
        phone: lender.phone || "N/A",
        type: "loan",
      },
    ];



    await Notification.insertMany(notifications);

    return res.status(201).json({
      message: "Loan request submitted successfully",
      status: loan.status,
      loan
    });

  } catch (error) {
    console.error("Error requesting loan:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

/* =====================================================
   🔟 GET ALL LOAN REQUESTS
===================================================== */
exports.getAllLoanRequests = async (req, res) => {
  const lenderId = req.user._id;

  const loans = await Loan.find({
    lenderId,
    loanRequestStatus: "pending"
  }).populate("borrowerId requestedByAgentId lenderId");

 loans.forEach((loan) => {
  const borrower = loan.borrowerId;

  if (!borrower) return;

  const isFirstLoan =
    (borrower.totalLoans || 0) === 0 &&
    (borrower.completedLoans || 0) === 0;

  loan._doc.existingUser = !isFirstLoan;

  // 🔥 If first-time borrower → merge borrower details into loan
  if (isFirstLoan) {
    Object.assign(loan._doc, borrower.toObject());
  }
});


  res.json({ loans });
};


/* =====================================================
   1️⃣1️⃣ REVIEW LOAN REQUEST
===================================================== */
exports.reviewLoanRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { loanId, action } = req.body;
    const lenderId = req.user._id;

    /* ===============================
       1️⃣ BASIC VALIDATION
    =============================== */
    if (!loanId || !action) {
      throw new Error("loanId and action are required");
    }

    if (!["approved", "rejected"].includes(action)) {
      throw new Error("action must be 'approved' or 'rejected'");
    }

    /* ===============================
       2️⃣ FETCH LOAN
    =============================== */
    const loan = await Loan.findById(loanId)
      .populate("borrowerId")
      .populate("requestedByAgentId")
      .populate("lenderId")
      .session(session);

    if (!loan) {
      throw new Error("Loan not found");
    }

    /* ===============================
       3️⃣ AUTHORIZATION
    =============================== */
    if (loan.lenderId._id.toString() !== lenderId.toString()) {
      throw new Error("Unauthorized review attempt");
    }

    if (loan.loanRequestStatus !== "pending") {
      throw new Error(`Loan already ${loan.loanRequestStatus}`);
    }

    const borrower = loan.borrowerId;
    const agent = loan.requestedByAgentId;
    const lender = loan.lenderId;

    /* ===============================
       4️⃣ REJECTION FLOW
    =============================== */
    if (action === "rejected") {
      loan.loanRequestStatus = "rejected";
      await loan.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        message: "Loan rejected successfully",
        loanId: loan._id
      });
    }

    /* ===============================
       5️⃣ CREDIT SCORE RULES
    =============================== */
  const creditScore = borrower.creditScore || loan.creditScoreAfter || 500;

// first-time borrower check
const isFirstLoan =
  (borrower.totalLoans || 0) === 0 &&
  (borrower.completedLoans || 0) === 0;

// ❌ Reject ONLY if:
//  - creditScore < 600
//  - AND NOT first loan
if (creditScore < 600 && !isFirstLoan) {
  loan.loanRequestStatus = "rejected";
  await loan.save({ session });

  await session.commitTransaction();
  session.endSession();

  return res.status(400).json({
    message: "Loan rejected due to low credit score",
    creditScore,
    isFirstLoan
  });
}

// ⭐ Bonus for very high score
if (creditScore >= 800) {
  loan.amount = Math.round(loan.amount * 1.2);
  loan.totalRepayment = loan.amount + loan.interest;
  loan.balance = loan.totalRepayment;
}

    /* ===============================
       6️⃣ LENDER WALLET CHECK
    =============================== */
    if (lender.walletBalance < loan.amount) {
      throw new Error("Insufficient wallet balance");
    }

    /* ===============================
       7️⃣ APPROVE LOAN (NOT ACTIVE YET)
    =============================== */
    loan.loanRequestStatus = "approved";
    loan.status = "pending"; // will become active after B2C callback
    loan.issuedByLenderId = lenderId;

    await loan.save({ session });

    /* ===============================
       8️⃣ CREATE PENDING TRANSACTION
    =============================== */
    const [transaction] = await Transaction.create(
      [
        {
          userId: lenderId,
          userModel: "User",
          loanId: loan._id,
          type: "loan issued",
          amount: loan.amount,
          status: "pending",
          phone: borrower.phone,
          description: "Loan disbursement",
          balanceBefore: lender.walletBalance,
          balanceAfter: lender.walletBalance - loan.amount
        }
      ],
      { session }
    );

    /* ===============================
       9️⃣ AGENT COMMISSION (PENDING)
    =============================== */
    if (agent) {
      await AgentCommission.create(
        [
          {
            agentId: agent._id,
            loanId: loan._id,
            commissionType: "approval",
            amount: loan.amount * 0.0495,
            status: "pending"
          }
        ],
        { session }
      );
    }

    /* ===============================
       🔟 INITIATE M-PESA B2C
    =============================== */
    const b2cResponse = await initiateB2C(
      borrower.phone,
      loan.amount,
      transaction._id
    );

    if (!b2cResponse?.OriginatorConversationID) {
      throw new Error("Invalid B2C response from M-Pesa");
    }

    transaction.checkoutRequestID = b2cResponse.OriginatorConversationID;
    transaction.conversationID = b2cResponse.ConversationID;
    await transaction.save({ session });

    /* ===============================
       ✅ COMMIT
    =============================== */
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      message: "Loan approved — awaiting M-Pesa confirmation",
      loan: {
        id: loan._id,
        amount: loan.amount,
        status: loan.status,
        loanRequestStatus: loan.loanRequestStatus
      },
      transaction: {
        id: transaction._id,
        checkoutRequestID: transaction.checkoutRequestID
      },
      b2cResponse
    });

  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("❌ reviewLoanRequest error:", error);

    return res.status(500).json({
      message: error.message
    });
  }
};




/* =====================================================
   1️⃣2️⃣ GET ACTIVE LOANS BY AGENT
===================================================== */
exports.getActiveLoansByAgent = async (req, res) => {
  try {
    const agentId = req.user._id;

    console.log("Logged-in agent:", agentId);

    const loans = await Loan.find({
      requestedByAgentId: agentId,
      loanRequestStatus: "approved",
      status: { $in: ["active", "overdue"] } // ✅ support overdue
    })
      .populate("borrowerId") // Customer details
      .populate("lenderId")   // Lender (User) details
      .sort({ createdAt: -1 });

    if (!loans.length) {
      return res.status(200).json({
        success: true,
        message: "No active or overdue loans found for this agent",
        totalLoans: 0,
        loans: []
      });
    }

    return res.status(200).json({
      success: true,
      totalLoans: loans.length,
      loans
    });

  } catch (error) {
    console.error("❌ getActiveLoansByAgent error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch agent loans"
    });
  }
};


exports.getPaymentInstructions = async (req, res) => {
  try {
    const { loanId } = req.params;

    const loan = await Loan.findById(loanId).populate("borrowerId");
    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }

    if (loan.status === "fully paid") {
      return res.status(400).json({ message: "Loan already fully paid" });
    }

    return res.json({
      success: true,
      payment: {
        loanId: loan._id,
        borrowerName: loan.borrowerId.fullName,
        amountDue: loan.balance,
        paybill: process.env.MPESA_SHORTCODE,
        accountNumber: loan.borrowerId.idNumber, // BillRefNumber
        phone: loan.borrowerId.phone
      }
    });
  } catch (err) {
    console.error("getPaymentInstructions error:", err);
    res.status(500).json({ message: "Server error" });
  }
};



exports.getCustomerStatement = async (req, res) => {
  try {
    const { borrowerId } = req.params;
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ message: "from and to dates are required" });
    }

    const startDate = new Date(from);
    const endDate = new Date(to);
    endDate.setHours(23, 59, 59, 999);

    const borrower = await Customer.findById(borrowerId);
    if (!borrower) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const transactions = await Transaction.find({
      userId: borrowerId,
      userModel: "Customer",
      status: "successful",
      createdAt: { $gte: startDate, $lte: endDate }
    }).sort({ createdAt: 1 });

    let totalDeposits = 0;
    let totalWithdrawals = 0;

    transactions.forEach(tx => {
      if (tx.type.includes("deposit")) {
        totalDeposits += tx.amount;
      }
      if (tx.type.includes("withdraw")) {
        totalWithdrawals += tx.amount;
      }
    });

    const openingBalance =
      borrower.savingsBalance - totalDeposits + totalWithdrawals;

    return res.status(200).json({
      customer: borrower.fullName,
      phone: borrower.phone,
      period: `${from} to ${to}`,
      openingBalance,
      totalDeposits,
      totalWithdrawals,
      closingBalance: borrower.savingsBalance,
      transactions
    });

  } catch (error) {
    console.error("Statement error:", error);
    res.status(500).json({ message: "Server error" });
  }
};


exports.sendStatementSMS = async (req, res) => {
  try {
    const { borrowerId, from, to } = req.body;

    if (!borrowerId || !from || !to) {
      return res.status(400).json({
        message: "borrowerId, from, to are required"
      });
    }

    const borrower = await Customer.findById(borrowerId);
    if (!borrower) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const transactions = await Transaction.find({
      userId: borrowerId,
      userModel: "Customer",
      status: "successful",
      createdAt: {
        $gte: new Date(from),
        $lte: new Date(to)
      }
    });

    let totalDeposits = 0;
    let totalWithdrawals = 0;

    transactions.forEach(tx => {
      if (tx.type.includes("deposit")) {
        totalDeposits += tx.amount;
      }
      if (tx.type.includes("withdraw")) {
        totalWithdrawals += tx.amount;
      }
    });

    const message = `
IZI FINANCE STATEMENT

Customer: ${borrower.fullName}
Period: ${from} - ${to}

Deposits: KES ${totalDeposits}
Withdrawals: KES ${totalWithdrawals}
Current Balance: KES ${borrower.savingsBalance}

Thank you.
`;

    await sendSMS(borrower.phone, message);

    return res.status(200).json({
      success: true,
      message: "Statement SMS sent successfully",
      smsContent: message 
    });

  } catch (error) {
    console.error("SMS statement error:", error);
    res.status(500).json({ message: "Server error" });
  }
};


