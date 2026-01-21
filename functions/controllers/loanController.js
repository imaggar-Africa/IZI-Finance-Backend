const Loan = require("../models/Loan");
const mongoose = require("mongoose");
const Customer = require("../models/customer");
const Transaction = require("../models/Transaction");
const { initiateB2C, initiateSTKPush } = require("../utils/mpesa");
const { sendSMS } = require("../utils/sms");
const User = require("../models/User");
const asyncHandler = require("express-async-handler");
const { normalizeToE164 } = require("../utils/phone");
const Notification = require("../models/Notification");
const AgentModel = require("../models/AgentModel");
const AgentCommission = require("../models/AgentCommission");
const { recalculateCreditScore } = require("../utils/creditScore");
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
===================================================== */
exports.trackRepayment = async (req, res) => {
  try {
    const borrowerId = req.borrower._id;
    const { loanId, amount } = req.body;

    if (!loanId || !amount || amount <= 0) {
      return res.status(400).json({ message: "loanId and valid amount are required" });
    }

    const borrower = await Customer.findById(borrowerId);
    if (!borrower || borrower.isDeleted) {
      return res.status(404).json({ message: "Borrower not found" });
    }

    const loan = await Loan.findOne({
      _id: loanId,
      borrowerId,
      status: { $ne: "fully paid" }
    });

    if (!loan) {
      return res.status(404).json({ message: "Loan not found or already fully paid" });
    }

    if (amount > loan.balance) {
      return res.status(400).json({
        message: `Amount exceeds outstanding balance (${loan.balance})`
      });
    }

    const normalizedPhone = normalizeToE164(borrower.phone, "KE");
    if (!normalizedPhone) {
      return res.status(400).json({ message: "Invalid borrower phone number" });
    }

    const transaction = await Transaction.create({
      type: "repayment",
      userId: borrowerId,
      userModel: "Customer",
      loanId: loan._id,
      amount,
      balanceBefore: loan.balance,
      balanceAfter: loan.balance,
      phone: normalizedPhone,
      status: "pending"
    });

    const stkResponse = await initiateSTKPush(
      normalizedPhone,
      amount,
      `Loan-${loan._id}`
    );

    if (!stkResponse?.CheckoutRequestID) {
      return res.status(500).json({ message: "Failed to initiate STK push" });
    }

    transaction.checkoutRequestID = stkResponse.CheckoutRequestID;
    await transaction.save();

    return res.status(200).json({
      success: true,
      message: "STK Push sent. Complete payment on your phone.",
      checkoutRequestID: stkResponse.CheckoutRequestID,
      transactionId: transaction._id
    });

  } catch (error) {
    console.error("❌ trackRepayment error:", error);
    return res.status(500).json({ message: "Failed to initiate repayment" });
  }
};

/* =====================================================
   2️⃣ ISSUE LOAN (DIRECT LENDER)
===================================================== */
exports.issueLoan = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const lenderId = req.user._id;
    const { borrowerId, amount, totalInterest, duration, repaymentFrequency, phoneNumber } = req.body;

    if (!borrowerId || !amount || !totalInterest || !duration || !repaymentFrequency || !phoneNumber) {
      await session.abortTransaction();
      return res.status(400).json({ message: "All fields are required" });
    }

    const lender = await User.findById(lenderId).session(session);
    if (!lender) throw new Error("Lender not found");
    if (lender.walletBalance < amount) throw new Error("Insufficient wallet balance");

    const borrower = await Customer.findById(borrowerId).session(session);
    if (!borrower) throw new Error("Borrower not found");

    const existingLoan = await Loan.findOne({
      borrowerId,
      status: { $in: ["pending", "active", "overdue"] }
    }).session(session);

    if (existingLoan) {
      throw new Error("Borrower already has an active loan");
    }

    const totalRepayment = parseFloat(amount) + parseFloat(totalInterest);
    const numInstallments =
      duration *
      (repaymentFrequency === "weekly"
        ? 7
        : repaymentFrequency === "monthly"
        ? 30
        : 1);

    const dailyRepayment = totalRepayment / numInstallments;

    const loan = await Loan.create([{
      lenderId,
      borrowerId,
      clientId: borrower.idNumber,
      fullName: borrower.fullName,
      phoneNumber,
      lenderPhone: lender.phone,
      amount,
      interest: totalInterest,
      totalRepayment,
      balance: totalRepayment,
      dailyRepayment,
      duration,
      dueDate: new Date(Date.now() + duration * 86400000),
      status: "pending"
    }], { session });

    lender.walletBalance -= amount;
    await lender.save({ session });

    const transaction = await Transaction.create([{
      userId: lenderId,
      userModel: "User",
      loanId: loan[0]._id,
      type: "loan issued",
      amount,
      status: "pending",
      phone: phoneNumber
    }], { session });

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      message: "Loan issued successfully",
      loan: loan[0],
      transaction: transaction[0]
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
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
   6️⃣ GET OUTSTANDING LOANS
===================================================== */
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
      requestedAmount: loan.amount
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
    const { borrowerId, amount, totalInterest, duration, repaymentFrequency } = req.body;

    const borrower = await Customer.findById(borrowerId);
    if (!borrower) return res.status(404).json({ message: "Borrower not found" });

    const creditScore = borrower.creditScore || 500;
    const decision = evaluateLoanByCreditScore({
      creditScore,
      requestedAmount: amount
    });

    if (!decision.allowed) {
      return res.status(400).json({
        message: "Loan blocked due to low credit score",
        creditScore
      });
    }

    const agent = await AgentModel.findById(agentId);
    const lender = await User.findById(agent.lenderId);

    const loan = await Loan.create({
      lenderId: lender._id,
      borrowerId,
      requestedByAgentId: agentId,
      fullName: borrower.fullName,
      phoneNumber: borrower.phone,
      lenderPhone: lender.phone,
      amount: decision.approvedAmount,
      interest: totalInterest,
      totalRepayment: decision.approvedAmount + totalInterest,
      duration,
      status: "pending",
      loanRequestStatus: "pending"
    });

    res.status(201).json({ loan });

  } catch (error) {
    res.status(500).json({ message: error.message });
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

  res.json({ loans });
};

/* =====================================================
   1️⃣1️⃣ REVIEW LOAN REQUEST
===================================================== */
exports.reviewLoanRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  console.log("DEBUG req.user:", req.user);


  try {
    const { loanId, action } = req.body;
    const lenderId = req.user._id;

    /* ===============================
       1️⃣ BASIC VALIDATION
    =============================== */
    if (!loanId || !action) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: "loanId and action are required"
      });
    }

    if (!["approved", "rejected"].includes(action)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: "action must be 'approved' or 'rejected'"
      });
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
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message: "Loan not found"
      });
    }

    /* ===============================
       3️⃣ AUTHORIZATION CHECK
    =============================== */
    if (loan.lenderId._id.toString() !== lenderId.toString()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        message: "You are not authorized to review this loan"
      });
    }

    /* ===============================
       4️⃣ STATUS CHECK
    =============================== */
    if (loan.loanRequestStatus !== "pending") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `Loan already ${loan.loanRequestStatus}`
      });
    }

    const borrower = loan.borrowerId;
    const lender = loan.lenderId;

    /* ===============================
       5️⃣ MANUAL REJECTION
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
       6️⃣ CREDIT SCORE RULES
    =============================== */
    const creditScore = borrower.creditScore || loan.creditScoreAfter || 500;

    // ❌ Block low score
    if (creditScore < 600) {
      loan.loanRequestStatus = "rejected";
      await loan.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.status(400).json({
        message: "Loan rejected due to low credit score",
        creditScore
      });
    }

    // ✅ High score bonus
    if (creditScore >= 800) {
      loan.amount = Math.round(loan.amount * 1.2);
      loan.totalRepayment = loan.amount + loan.interest;
      loan.balance = loan.totalRepayment;
    }

    /* ===============================
       7️⃣ LENDER WALLET CHECK
    =============================== */
    if (lender.walletBalance < loan.amount) {
      throw new Error("Insufficient wallet balance");
    }

    /* ===============================
       8️⃣ APPROVE LOAN
    =============================== */
    loan.loanRequestStatus = "approved";
    loan.status = "pending";
    loan.issuedByLenderId = lenderId;

    await loan.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      message: "Loan approved successfully",
      loan
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
exports.getActiveLoans = async (req, res) => {
  try {
    console.log("Logged-in lender:", req.user._id);

    const loans = await Loan.find({
      lenderId: req.user._id,
      loanRequestStatus: "approved",
      status: { $in: ["active", "overdue"] }
    }).populate("borrowerId");

    return res.status(200).json({
      success: true,
      loans
    });

  } catch (error) {
    console.error("getActiveLoans error:", error);
    return res.status(500).json({
      message: "Failed to fetch active loans"
    });
  }
};

/* =====================================================
   1️⃣3️⃣ MPESA STK REPAYMENT CALLBACK (CRITICAL)
===================================================== */
exports.stkRepaymentCallback = async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) return res.status(200).json({});

    const { CheckoutRequestID, ResultCode } = callback;
    if (ResultCode !== 0) return res.status(200).json({});

    const transaction = await Transaction.findOne({ checkoutRequestID: CheckoutRequestID });
    if (!transaction) return res.status(404).json({});

    const loan = await Loan.findById(transaction.loanId);
    if (!loan) return res.status(404).json({});

    const today = new Date();
    const expectedPaymentDate =
      new Date(loan.issueDate.getTime() + (loan.repayments.length + 1) * 86400000);

    const wasLate = today > expectedPaymentDate;
    const daysLate = wasLate
      ? Math.ceil((today - expectedPaymentDate) / 86400000)
      : 0;

    const { scoreDelta, newScore } = await recalculateCreditScore({
      currentScore: loan.creditScoreAfter || 500,
      wasPaymentLate: wasLate,
      daysLate
    });

    loan.repaidAmount += transaction.amount;
    loan.balance -= transaction.amount;
    loan.creditScoreAfter = newScore;

    // ✅ ADDITIVE: persist to Customer
    await Customer.findByIdAndUpdate(loan.borrowerId, {
      creditScore: newScore
    });

    loan.repayments.push({
      transactionId: transaction._id,
      amount: transaction.amount,
      wasPaymentLate: wasLate,
      daysLate,
      creditScoreDelta: scoreDelta,
      date: today
    });

    loan.status =
      loan.balance <= 0 ? "fully paid" : wasLate ? "overdue" : "active";

    transaction.status = "successful";
    transaction.balanceAfter = loan.balance;

    await loan.save();
    await transaction.save();

    res.json({ success: true });

  } catch (error) {
    res.status(500).json({});
  }
};


