const Loan = require("../models/Loan");
const mongoose = require("mongoose");
const Customer = require("../models/customer");
const Transaction = require("../models/Transaction");
const { initiateB2C, initiateSTKPush } = require("../utils/mpesa"); // Import M-Pesa function
const { sendSMS } = require("../utils/sms");
const User = require("../models/User");
const asyncHandler = require("express-async-handler");
const { normalizeToE164 } = require("../utils/phone");
const Notification = require("../models/Notification");
const AgentModel = require("../models/AgentModel");
// Track loan repayment and send SMS
const AgentCommission = require('../models/AgentCommission');
const { recalculateCreditScore } = require("../utils/creditScore");
const { evaluateLoanByCreditScore } = require("../utils/loanApprovalRules");

// Helper: retry function for transient transaction errors
const runTransactionWithRetry = async (txnFunc, session, maxRetries = 3) => {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await txnFunc();
    } catch (err) {
      if (err.hasErrorLabel && err.hasErrorLabel("TransientTransactionError")) {
        attempt++;
        console.warn(`⚠️ Transaction conflict, retrying attempt ${attempt}`);
        continue; // retry
      }
      throw err;
    }
  }
  throw new Error("Transaction failed after retries");
};

// Track loan repayment (INITIATE STK PUSH)
// Track loan repayment
exports.trackRepayment = async (req, res) => {
  try {
    const borrowerId = req.borrower._id;
    const { loanId, amount } = req.body;

    /* ---------------- VALIDATION ---------------- */
    if (!loanId || !amount || amount <= 0) {
      return res.status(400).json({
        message: "loanId and valid amount are required"
      });
    }

    /* ---------------- BORROWER ---------------- */
    const borrower = await Customer.findById(borrowerId);
    if (!borrower || borrower.isDeleted) {
      return res.status(404).json({ message: "Borrower not found" });
    }

    /* ---------------- LOAN ---------------- */
    const loan = await Loan.findOne({
      _id: loanId,
      borrowerId,
      status: { $ne: "fully paid" }
    });

    if (!loan) {
      return res.status(404).json({
        message: "Loan not found or already fully paid"
      });
    }

    if (amount > loan.balance) {
      return res.status(400).json({
        message: `Amount exceeds outstanding balance (${loan.balance})`
      });
    }

    /* ---------------- PHONE ---------------- */
    const normalizedPhone = normalizeToE164(borrower.phone, "KE");
    if (!normalizedPhone) {
      return res.status(400).json({ message: "Invalid borrower phone number" });
    }

    /* ---------------- TRANSACTION (PENDING) ---------------- */
    const transaction = await Transaction.create({
      type: "repayment",
      userId: borrowerId,
      userModel: "Customer",
      loanId: loan._id,
      amount,
      balanceBefore: loan.balance,
      balanceAfter: loan.balance, // updated after callback
      phone: normalizedPhone,
      status: "pending"
    });

    /* ---------------- STK PUSH ---------------- */
    const accountReference = `Loan-${loan._id}`;
    const stkResponse = await initiateSTKPush(
      normalizedPhone,
      amount,
      accountReference
    );

    if (!stkResponse?.CheckoutRequestID) {
      return res.status(500).json({
        message: "Failed to initiate STK push"
      });
    }

    // Save CheckoutRequestID for callback matching
    transaction.checkoutRequestID = stkResponse.CheckoutRequestID;
    await transaction.save();

    /* ---------------- RESPONSE ---------------- */
    return res.status(200).json({
      success: true,
      message: "STK Push sent. Complete payment on your phone.",
      checkoutRequestID: stkResponse.CheckoutRequestID,
      transactionId: transaction._id
    });

  } catch (error) {
    console.error("❌ trackRepayment error:", error);
    return res.status(500).json({
      message: "Failed to initiate repayment",
      error: error.message
    });
  }
};

// Issue a new loan with M-Pesa disbursement
// Issue Loan
exports.issueLoan = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const lenderId = req.user._id;
    const { borrowerId, amount, totalInterest, duration, repaymentFrequency, phoneNumber } = req.body;

    // --- Validate input ---
    if (!borrowerId || !amount || !totalInterest || !duration || !repaymentFrequency || !phoneNumber) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "All fields are required" });
    }

    // --- Lender check ---
    const lender = await User.findById(lenderId).session(session);
    if (!lender) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Lender not found" });
    }
    if (lender.walletBalance < amount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Insufficient wallet balance" });
    }

    // --- Borrower check ---
    const borrower = await Customer.findById(borrowerId).session(session);
    if (!borrower) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Borrower not found" });
    }
 // --- Check if borrower already has an active/pending/overdue loan ---
    const existingLoan = await Loan.findOne({
      borrowerId,
      status: { $in: ["pending", "active", "overdue"] },
    }).session(session);

    if (existingLoan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `Borrower already has an existing loan (${existingLoan.status}). Only one loan can be active at a time.`,
      });
    }

    // --- Repayment calculation ---
    const totalRepayment = parseFloat(amount) + parseFloat(totalInterest);
    const numInstallments = duration * (repaymentFrequency === "weekly" ? 7 : repaymentFrequency === "monthly" ? 30 : 1);
    const dailyRepayment = totalRepayment / numInstallments;

    // --- Create Loan ---
    const loan = await Loan.create(
      [
        {
          lenderId,
          borrowerId,
          clientId: borrower.idNumber,
          fullName: borrower.fullName,
          phoneNumber,
          lenderPhone: lender.phone,
          amount,
          interest: parseFloat(totalInterest),
          fee: 0,
          totalRepayment,
          balance: totalRepayment,
          dailyRepayment,
          duration,
          dueDate: new Date(Date.now() + duration * 24 * 60 * 60 * 1000),
          status: "pending",
        },
      ],
      { session }
    );

    // --- Deduct lender wallet ---
    lender.walletBalance -= amount;
    await lender.save({ session });

    // --- Create Transaction ---
    const transaction = await Transaction.create(
      [
        {
          userId: lenderId,
          userModel:"User",
          loanId: loan[0]._id,
         type: "loan issued",
          amount,
          status: "pending",
          phone: phoneNumber,
          description: "Loan disbursement",
        },
      ],
      { session }
    );

    // --- Sandbox mode (simulate success) ---
    if (global.config.mpesaEnv === "sandbox")
 {


      transaction[0].status = "successful";
      await transaction[0].save({ session });

      loan[0].status = "active";
      await loan[0].save({ session });

      const normalizedPhone = normalizeToE164(phoneNumber, "KE");
      if (!normalizedPhone) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ message: "Invalid borrower phone number" });
      }

      // Send SMS to borrower
      await sendSMS(
        normalizedPhone,
        `✅ Hello ${borrower.fullName}, your loan of KES ${amount} has been issued.\nTotal repayment: KES ${totalRepayment}\nDaily: KES ${dailyRepayment.toFixed(
          2
        )}\nDue date: ${loan[0].dueDate.toDateString()}`
      );

      // Create Notification for lender
      await Notification.create(
        [
          {
            userId: lender._id,
            userModel: "User",   // 👈 Required for refPath
            title: "Loan Issued Successfully",
            message: `You have issued a loan of KES ${amount} to ${borrower.fullName}. Total repayment: KES ${totalRepayment}.`,
            type: "loan_approved",
          },
        ],
        { session }
      );
    }

// --- Create Notification for borrower
await Notification.create(
  [
    {
      userId: borrower._id,
        userModel: "Customer",   // 👈 Required for refPath
      // borrowerId: borrower._id,
      title: "Loan Issued",
      message: `✅ Hello ${borrower.fullName}, your loan of KES ${amount} has been issued. Total repayment: KES ${totalRepayment}. Due date: ${loan[0].dueDate.toDateString()}`,
      type: "loan",
    },
  ],
  { session }
);
    // --- Commit DB transaction ---
    await session.commitTransaction();
    session.endSession();

    // --- Return response ---
   if (global.config.mpesaEnv === "sandbox")
 {
      return res.status(201).json({
        message: "Loan issued successfully (sandbox mode)",
        loan: loan[0],
        transaction: transaction[0],
      });
    } else {
      // --- LIVE MODE ---
      const b2cResponse = await initiateB2C(phoneNumber, amount, transaction[0]._id);

      // Save Mpesa checkoutRequestID for callback mapping
      if (b2cResponse?.OriginatorConversationID) {
        transaction[0].checkoutRequestID = b2cResponse.OriginatorConversationID;
        await transaction[0].save();
      }

      return res.status(201).json({
        message: "Loan initiated successfully. Awaiting B2C confirmation.",
        loan: loan[0],
        transaction: transaction[0],
        b2cResponse,
      });
    }
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Error issuing loan:", error);
    return res.status(500).json({ message: "Error issuing loan", error: error.message });
  }
};

// GET borrower loans (excluding fully paid) by phone
exports.  getActiveLoansByPhone = async (req, res) => {
  try {
    const borrower = req.borrower; // Already from token

    const loans = await Loan.find({
      borrowerId: borrower._id,
      status: { $ne: "fully paid" }
    }).sort({ dueDate: 1 });

    res.json({
      success: true,
      borrower: {
        id: borrower._id,
        fullName: borrower.fullName,
        phone: borrower.phone,
        isVerified: borrower.isVerified,
      },
      loans,
    });
  } catch (err) {
    console.error("getActiveLoansByPhone error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get fully paid loans
exports.getFullyPaidLoans = async (req, res) => {
  try {
    const loans = await Loan.find({
      loanRequestStatus: "approved",
      status: "fully paid"
    }).populate("borrowerId");

    res.status(200).json({
      message: "Fully paid loans retrieved successfully",
      loans
    });
  } catch (error) {
    console.error("Error fetching fully paid loans:", error);
    res.status(500).json({ message: "Error fetching fully paid loans" });
  }
};




// Controller: Get all customers with total and fully paid loans
exports.getAllCustomersWithLoansFullyPaid = async (req, res) => {
  try {
    // Step 1: Fetch all customers
    const customers = await Borrower.find();

    // Step 2: Aggregate loans per customer
    const loanStats = await Loan.aggregate([
      {
        $group: {
          _id: "$borrowerId",
          totalLoans: { $sum: 1 },
          fullyPaidLoans: {
            $sum: {
              $cond: [{ $eq: ["$status", "fully paid"] }, 1, 0]
            }
          }
        }
      }
    ]);

    // Step 3: Map loan stats to customers
    const customersWithStats = customers.map((customer) => {
      const stats = loanStats.find((l) => l._id.toString() === customer._id.toString());
      return {
        _id: customer._id,
        fullName: customer.fullName,
        phone: customer.phone,
        idNumber: customer.idNumber,
        totalLoans: stats ? stats.totalLoans : 0,
        fullyPaidLoans: stats ? stats.fullyPaidLoans : 0,
        savingsBalance: customer.savingsBalance,
        isVerified: customer.isVerified,
        createdAt: customer.createdAt
      };
    });

    res.status(200).json({ data: customersWithStats });
  } catch (error) {
    console.error("Error fetching customers with loan stats:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};


exports.getFullyPaidLoansByCustomer = async (req, res) => {
  try {
    const { borrowerId } = req.params;

    // 1️⃣ Find borrower
    const borrower = await Customer.findById(borrowerId);
    if (!borrower) {
      return res.status(404).json({ message: "❌ Borrower not found" });
    }

    // 2️⃣ Find loans with status 'fully paid'
    const loans = await Loan.find({
      borrowerId,
      status: "fully paid",
    });

    if (loans.length === 0) {
      return res.status(200).json({ message: "✅ No fully paid loans for this borrower" });
    }

    // 3️⃣ Return fully paid loans
    return res.status(200).json({
      message: "📄 Fully paid loans retrieved successfully",
      borrower: borrower.fullName,
      count: loans.length,
      loans: loans.map(loan => ({
        loanId: loan._id,
        amount: loan.amount,
        interest: loan.interest,
        totalRepayment: loan.totalRepayment,
        repaidAmount: loan.repaidAmount,
        balance: loan.balance,
        duration: loan.duration,
        issueDate: loan.issueDate,
        dueDate: loan.dueDate,
        lastReminderSent: loan.lastReminderSent,
        repayments:loan.repayments
      })),
    });

  } catch (error) {
    console.error("❌ Error fetching fully paid loans:", error);
    return res.status(500).json({
      message: "Error fetching fully paid loans",
      error: error.message,
    });
  }
};



exports.getOutstandingLoans = async (req, res) => {
  try {
    const outstandingLoans = await Loan.find({
      loanRequestStatus: "approved",
      status: "active"
    }).populate("borrowerId");

    res.status(200).json(outstandingLoans);
  } catch (error) {
    console.error("Error fetching outstanding loans:", error);
    res.status(500).json({ message: "Server error" });
  }
};



// ----------------------------
// API 1: Get Borrower by ID (with active/overdue loan)
// ----------------------------
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

    let totalLoanAmount = 0;
    let totalCollectedAmount = 0;
    let totalActiveLoanCount = 0;
    let totalOverdueLoanCount = 0;

    const paidToday = [];
    const notPaidToday = [];

    loans.forEach(loan => {
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

      totalLoanAmount += loan.amount || 0;
      totalCollectedAmount += loan.repaidAmount || 0;

      /* ---------------- LAST PAYMENT ---------------- */
      let lastPaymentDate = null;
      let paidTodayFlag = false;

      if (Array.isArray(loan.repayments) && loan.repayments.length > 0) {
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

      /* ---------------- STATUS BADGE ---------------- */
      const isOverdue = new Date(loan.dueDate) < new Date();
      if (isOverdue) totalOverdueLoanCount++;

      const statusBadge =
        isOverdue || !paidTodayFlag ? "At Risk" : "On Track";

      /* ---------------- ENRICH LOAN OBJECT ---------------- */
      const enrichedLoan = {
        ...loan.toObject(),
        expectedDailyAmount,
        lastPaymentDate,
        paidToday: paidTodayFlag,
        statusBadge
      };

      borrowerMap[borrowerId].loans.push(enrichedLoan);

      /* ---------------- TAB ROWS ---------------- */
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
        totalActiveLoanCount,
        totalOverdueLoanCount
      },
      data: Object.values(borrowerMap), // FULL ORIGINAL DATA (UNCHANGED)
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




// ----------------------------
// API 2: Get All Loans for a Borrower
// ----------------------------
exports.getLoansByBorrower = async (req, res) => {
  try {
    const { borrowerId } = req.params;

    /* ================================
       1️⃣ VALIDATE BORROWER ID
       ================================ */
    if (!mongoose.Types.ObjectId.isValid(borrowerId)) {
      return res.status(400).json({ message: "Invalid borrowerId" });
    }

    /* ================================
       2️⃣ FETCH BORROWER DETAILS
       ================================ */
    const borrower = await Customer.findById(borrowerId).select(
      "fullName phone idNumber"
    );

    if (!borrower) {
      return res.status(404).json({ message: "Borrower not found" });
    }

    /* ================================
       3️⃣ FETCH APPROVED ACTIVE / OVERDUE LOANS
       ================================ */
    const loans = await Loan.find({
      borrowerId: new mongoose.Types.ObjectId(borrowerId),
      loanRequestStatus: "approved",
      status: { $in: ["active", "overdue"] }
    }).sort({ createdAt: -1 });

    /* ================================
       4️⃣ REPAYMENT SUMMARY (COUNT BASED)
       Remaining Payments = Duration − Payments Made
       ================================ */
    let paymentsMade = 0;
    let totalExpectedPayments = 0;
    let lastPaymentDate = null;

    loans.forEach(loan => {
      const expectedPayments = loan.duration || 0;
      totalExpectedPayments += expectedPayments;

      if (Array.isArray(loan.repayments)) {
        paymentsMade += loan.repayments.length;

        loan.repayments.forEach(r => {
          if (!lastPaymentDate || new Date(r.date) > new Date(lastPaymentDate)) {
            lastPaymentDate = r.date;
          }
        });
      }
    });

    const remainingPaymentsCount = Math.max(
      totalExpectedPayments - paymentsMade,
      0
    );

    const averagePayment =
      paymentsMade > 0
        ? Math.round(
            loans.reduce((sum, l) => sum + (l.repaidAmount || 0), 0) /
              paymentsMade
          )
        : 0;

    /* ================================
       5️⃣ RESPONSE
       ================================ */
    return res.status(200).json({
      success: true,
      borrower,
      totalLoans: loans.length,
      loans,
      repaymentSummary: {
        paymentsMade,
        remainingPaymentsCount,
        averagePayment,
        lastPaymentDate
      }
    });

  } catch (error) {
    console.error("❌ Error fetching loans by borrower:", error);
    return res.status(500).json({ message: "Server error" });
  }
};






// --- Agent creates a loan request ---
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

exports.getAllLoanRequests = async (req, res) => {
  try {
    const lenderId = req.user._id; // Authenticated lender

    // ✅ Fetch all loans where the lender is this lender and status is pending
    const loans = await Loan.find({
      lenderId: lenderId,
      loanRequestStatus: "pending",
    })
      .populate("borrowerId", "fullName phone idNumber")
      .populate("requestedByAgentId", "name phone")
      .populate("lenderId", "name phone")
      .sort({ createdAt: -1 });

    // ✅ Response
    if (!loans.length) {
      return res.status(200).json({
        message: "No pending loan requests found for this lender.",
        loans: [],
      });
    }

    res.status(200).json({
      message: "Pending loan requests fetched successfully",
      total: loans.length,
      loans,
    });
  } catch (error) {
    console.error("❌ Error fetching loan requests:", error);
    res.status(500).json({
      message: "Error fetching loan requests",
      error: error.message,
    });
  }
};

exports.reviewLoanRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const lenderId = req.user._id;
    const { loanId, action } = req.body;

    if (!loanId || !action) {
      return res.status(400).json({ message: "loanId and action are required" });
    }

    if (!["approved", "rejected"].includes(action)) {
      return res.status(400).json({ message: "Action must be 'approved' or 'rejected'." });
    }

    const loan = await Loan.findById(loanId)
      .populate("borrowerId")
      .populate("requestedByAgentId")
      .populate("lenderId")
      .session(session);

    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }

    if (loan.lenderId._id.toString() !== lenderId.toString()) {
      return res.status(403).json({ message: "Unauthorized review attempt." });
    }

    if (loan.loanRequestStatus !== "pending") {
      return res.status(400).json({ message: `Loan already ${loan.loanRequestStatus}.` });
    }

    const borrower = loan.borrowerId;
    const agent = loan.requestedByAgentId;
    const lender = loan.lenderId;

    /* =========================
       ❌ REJECTION FLOW (MANUAL)
       ========================= */
    if (action === "rejected") {
      loan.loanRequestStatus = "rejected";
      await loan.save({ session });

      const notifications = [{
        userId: borrower._id,
        userModel: "Customer",
        title: "Loan Rejected",
        message: `Sorry ${borrower.fullName}, your loan of KES ${loan.amount} was rejected.`,
        type: "loan"
      }];

      if (agent) {
        notifications.push({
          userId: agent._id,
          userModel: "Agent",
          title: "Loan Request Rejected",
          message: `Loan request for ${borrower.fullName} (KES ${loan.amount}) was rejected.`,
          type: "loan_rejected"
        });
      }

      await Notification.insertMany(notifications, { session });

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        message: "Loan rejected.",
        loan: {
          id: loan._id,
          amount: loan.amount,
          loanRequestStatus: loan.loanRequestStatus
        }
      });
    }

    /* =========================
       ✅ APPROVAL FLOW
       ========================= */

    // Borrower already has loan
    const borrowerActiveLoan = await Loan.findOne({
      borrowerId: borrower._id,
      status: { $in: ["active", "overdue"] }
    }).session(session);

    if (borrowerActiveLoan) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: `Borrower has an existing active loan (${borrowerActiveLoan.status}).`
      });
    }

    /* =========================
       🆕 CREDIT SCORE RULES
       ========================= */
    const creditScore = borrower.creditScore || loan.creditScoreAfter || 500;

    // ❌ Block low score
    if (creditScore < 600) {
      loan.loanRequestStatus = "rejected";
      await loan.save({ session });

      await Notification.create([{
        userId: borrower._id,
        userModel: "Customer",
        title: "Loan Rejected",
        message: "Loan rejected due to low credit score.",
        type: "loan_rejected"
      }], { session });

      await session.commitTransaction();
      session.endSession();

      return res.status(400).json({
        message: "Loan rejected due to low credit score",
        creditScore
      });
    }

    // ✅ Increase loan for high score
    if (creditScore >= 800) {
      loan.amount = Math.round(loan.amount * 1.2); // +20%
      loan.totalRepayment = loan.amount + loan.interest;
      loan.balance = loan.totalRepayment;
    }

    // Lender balance validation (after adjustment)
    if (lender.walletBalance < loan.amount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Insufficient wallet balance." });
    }

    // Approve loan (pending until MPesa callback)
    loan.loanRequestStatus = "approved";
    loan.status = "pending";
    loan.issuedByLenderId = lender._id;
    await loan.save({ session });

    // Create pending transaction
    const [transaction] = await Transaction.create([{
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
    }], { session });

    // Agent commission
    if (agent) {
      await AgentCommission.create([{
        agentId: agent._id,
        loanId: loan._id,
        commissionType: "approval",
        amount: loan.amount * 0.0495,
        status: "pending"
      }], { session });
    }

    const b2cResponse = await initiateB2C(borrower.phone, loan.amount, transaction._id);

    if (!b2cResponse?.OriginatorConversationID) {
      throw new Error("Invalid B2C response from M-Pesa");
    }

    transaction.checkoutRequestID = b2cResponse.OriginatorConversationID;
    transaction.conversationID = b2cResponse.ConversationID;
    await transaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      message: "Loan approved — awaiting M-Pesa confirmation.",
      loan: {
        id: loan._id,
        amount: loan.amount,
        loanRequestStatus: loan.loanRequestStatus
      },
      transaction: {
        id: transaction._id,
        status: transaction.status
      }
    });

  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();

    console.error("❌ Review loan error:", err);
    return res.status(500).json({ message: "Error reviewing loan request" });
  }
};


exports.getActiveLoansByAgent = asyncHandler(async (req, res) => {
  const agentId = req.user._id;

  // Fetch full data
  const loans = await Loan.find({
    requestedByAgentId: agentId,
    loanRequestStatus: "approved",
    status: "active",
  })
    .populate("borrowerId") // ✅ Return full customer object
    .populate("lenderId")   // ✅ Return full lender object (User model)
    .sort({ createdAt: -1 });

  if (!loans || loans.length === 0) {
    return res.status(200).json({
      success: true,
      message: "No active loans found for this agent",
      loans: [],
    });
  }

  res.status(200).json({
    success: true,
    totalActiveLoans: loans.length,
    loans,
  });
});

// ----------------------------
// MPESA STK REPAYMENT CALLBACK
// ----------------------------
exports.stkRepaymentCallback = async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback) return res.status(200).json({});

    const { CheckoutRequestID, ResultCode } = callback;

    // ❌ Payment failed
    if (ResultCode !== 0) {
      return res.status(200).json({ message: "Payment failed" });
    }

    // 1️⃣ Find transaction
    const transaction = await Transaction.findOne({
      checkoutRequestID: CheckoutRequestID
    });

    if (!transaction) return res.status(404).json({});

    // 2️⃣ Find loan
    const loan = await Loan.findById(transaction.loanId);
    if (!loan) return res.status(404).json({});

    const today = new Date();

    // 3️⃣ Expected payment date logic
    const installmentIndex = loan.repayments.length + 1;
    const expectedPaymentDate = new Date(
      loan.issueDate.getTime() +
      installmentIndex * 24 * 60 * 60 * 1000
    );

    const wasPaymentLate = today > expectedPaymentDate;
    const daysLate = wasPaymentLate
      ? Math.ceil((today - expectedPaymentDate) / (1000 * 60 * 60 * 24))
      : 0;

    // 4️⃣ Credit score calculation (BASE SCORE = 500)
    const { scoreDelta, newScore } = await recalculateCreditScore({
      currentScore: loan.creditScoreAfter || 500,
      wasPaymentLate,
      daysLate
    });

    // 5️⃣ Update loan amounts
    loan.repaidAmount += transaction.amount;
    loan.balance -= transaction.amount;
    loan.creditScoreAfter = newScore;

    // 6️⃣ Push repayment record
    loan.repayments.push({
      transactionId: transaction._id,
      loanId: loan._id,
      borrowerId: loan.borrowerId,
      amount: transaction.amount,
      date: today,
      expectedPaymentDate,
      wasPaymentLate,
      daysLate,
      creditScoreDelta: scoreDelta
    });

    // 7️⃣ Update loan status + default logic
    if (loan.balance <= 0) {
      loan.status = "fully paid";
      loan.isDefaulted = false;
    } else if (wasPaymentLate) {
      loan.status = "overdue";
      loan.isDefaulted = daysLate > 30; // ✅ default after 30 days
    } else {
      loan.status = "active";
      loan.isDefaulted = false;
    }

    // 8️⃣ Update transaction
    transaction.status = "successful";
    transaction.balanceAfter = loan.balance;

    await loan.save();
    await transaction.save();

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("❌ STK CALLBACK ERROR:", error);
    return res.status(500).json({});
  }
};



