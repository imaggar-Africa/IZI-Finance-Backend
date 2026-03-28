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
const { evaluateLoanByCreditScore, getMaxLoanAmount } = require("../utils/loanApprovalRules");
const { getMpesaPaybillBalance } = require("../utils/getMpesaPaybillBalance");
const { getB2CCharge } = require("../utils/mpesaCharges");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
/* ====================================================
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

/**
 * 🆕 Get Customer Eligibility & Max Loan Amount
 * Returns the dynamic limit based on credit score and risk multipliers.
 */
exports.getEligibility = asyncHandler(async (req, res) => {
  const { borrowerId } = req.params;

  const borrower = await Customer.findById(borrowerId);
  if (!borrower) {
    return res.status(404).json({ success: false, message: "Borrower not found" });
  }

  const maxAmount = getMaxLoanAmount(borrower);

  res.status(200).json({
    success: true,
    data: {
      borrowerName: borrower.fullName,
      creditScore: borrower.creditScore || 500,
      creditLevel: borrower.creditLevel || "High Risk",
      maxLoanAmount: maxAmount,
      totalLoansTaken: borrower.totalLoansTaken || 0,
      latePayments: borrower.latePayments || 0
    }
  });
});


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
      agentId
    } = req.body;

    /* ================= VALIDATION ================= */
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

    /* ================= LENDER ================= */
    const lender = await User.findById(lenderId).session(session);
    if (!lender) throw new Error("Lender not found");

    /* 🔒 COMPANY KYC RESTRICTION */
    if (
      lender.accountType === "company" &&
      lender.kycStatus !== "approved"
    ) {
      throw new Error("Company KYC not approved. Cannot issue loan.");
    }

    /* ✅ WALLET BALANCE CHECK (WITH FEE) */
    const estimatedFee = getB2CCharge(Number(amount));
    const totalDebit = Number(amount) + estimatedFee;

    if (lender.walletBalance < totalDebit) {
      throw new Error(
        `Insufficient wallet balance. Required: ${totalDebit}`
      );
    }

    /* ================= BORROWER ================= */
    const borrower = await Customer.findById(borrowerId).session(session);
    if (!borrower) throw new Error("Borrower not found");
    if (borrower.is_blocked) throw new Error("Borrower is manually blocked");
    if (borrower.isDeleted) throw new Error("Borrower account inactive");
    if (!borrower.isVerified) throw new Error("Borrower not verified");

    /* ================= ELIGIBILITY CHECK ================= */
    const eligibility = evaluateLoanByCreditScore({
      creditScore: borrower.creditScore || 500,
      requestedAmount: Number(amount),
      borrower
    });

    if (!eligibility.allowed) {
      throw new Error(`Loan rejected: ${eligibility.reason || "Credit limit exceeded"}`);
    }


    /* ================= DUPLICATE CHECK (ONLY ACTIVE) ================= */
    const activeLoan = await Loan.findOne({
      borrowerId,
      status: "active"
    }).session(session);

    if (activeLoan) {
      throw new Error("Borrower already has an active loan");
    }

    /* ================= PAYBILL FLOAT CHECK ================= */
    const paybillBalance = await getMpesaPaybillBalance();
    if (paybillBalance < amount) {
      throw new Error("Insufficient float. Please top up.");
    }

    /* ================= CALCULATIONS ================= */
    const totalRepayment = Number(amount) + Number(totalInterest);
    const dailyRepayment =
      totalRepayment /
      (duration *
        (repaymentFrequency === "weekly"
          ? 7
          : repaymentFrequency === "monthly"
            ? 30
            : 1));

    /* ================= CREATE LOAN ================= */
    const [loan] = await Loan.create(
      [
        {
          lenderId,
          issuedByLenderId: lenderId,
          requestedByAgentId: agentId || null,

          borrowerId,
          billRefNumber: borrower.idNumber,
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

          status: "pending",
          loanRequestStatus: "initiated",

          repaidAmount: 0,
          repayments: []
        }
      ],
      { session }
    );

    /* ================= CREATE TRANSACTION ================= */
    const [transaction] = await Transaction.create(
      [
        {
          userId: lenderId,
          userModel: "User",
          loanId: loan._id,
          type: "loan issued",
          amount,
          status: "pending",
          phone: phoneNumber
        }
      ],
      { session }
    );

    /* ================= INITIATE B2C ================= */
    const b2cResponse = await initiateB2C(
      phoneNumber,
      amount,
      transaction._id
    );

    if (!b2cResponse?.OriginatorConversationID) {
      throw new Error("B2C initiation failed");
    }

    transaction.checkoutRequestID =
      b2cResponse.OriginatorConversationID;

    loan.loanRequestStatus = "processing";
 
    borrower.totalLoansTaken = (borrower.totalLoansTaken || 0) + 1;
    borrower.totalLoans = (borrower.totalLoans || 0) + 1;
 
    await transaction.save({ session });
    await loan.save({ session });
    await borrower.save({ session });


    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      success: true,
      message: "Loan initiated. Awaiting M-Pesa confirmation",
      loan,
      transaction
    });

  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    return res.status(400).json({ message: error.message });
  }
};

exports.generateFullyPaidLoansPDF = async (req, res) => {
  try {
    const { borrowerId } = req.params;

    const borrower = await Customer.findById(borrowerId);
    if (!borrower) {
      return res.status(404).json({ message: "Borrower not found" });
    }

    const loans = await Loan.find({
      borrowerId,
      status: "fully paid",
    }).populate("repayments");

    if (!loans || loans.length === 0) {
      return res.status(404).json({ message: "No fully paid loans found" });
    }

    // Preparatory calculations
    const totalLoansCleared = loans.length;
    let totalPrincipalPaid = 0;
    let totalOverallPaid = 0;

    const formattedLoans = loans.map((loan) => {
      const loanObj = loan.toObject();
      let loanTotalPaid = 0;
      let lastPaymentDate = null;

      if (loanObj.repayments?.length) {
        loanObj.repayments.forEach((payment) => {
          loanTotalPaid += payment.amount || 0;
          if (!lastPaymentDate || new Date(payment.date) > new Date(lastPaymentDate)) {
            lastPaymentDate = payment.date;
          }
        });
      }

      totalPrincipalPaid += loan.amount || 0;
      totalOverallPaid += loanTotalPaid;

      loanObj.totalPaid = loanTotalPaid;
      loanObj.lastPaymentDate = lastPaymentDate;
      return loanObj;
    });

    // Create PDF Document
    const doc = new PDFDocument({ size: "A4", margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=fully_paid_report_${borrowerId}.pdf`);
    doc.pipe(res);

    // --- Header & Logo ---
    const logoFilePath = path.join(__dirname, "../assets/izi-logo.png");
    if (fs.existsSync(logoFilePath)) {
      doc.image(logoFilePath, (doc.page.width - 110) / 2, 30, { width: 110 });
      doc.y = 110; // Move y below the image explicitly
    } else {
      doc.y = 50;
    }

    doc.fontSize(18).fillColor("#2c3e50").font("Helvetica-Bold").text("Fully Paid Loans Report", { align: "center" });
    doc.fontSize(10).fillColor("#27ae60").text("CLEARED & SETTLED", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor("#bdc3c7").font("Helvetica").text(`Generated on ${new Date().toLocaleString("en-GB")}`, { align: "right" });
    doc.moveDown(1);

    // --- Borrower Section ---
    doc.fillColor("#2c3e50").fontSize(14).font("Helvetica-Bold").text(borrower.fullName);
    doc.fontSize(10).fillColor("#7f8c8d").font("Helvetica").text(`Phone: ${borrower.phone} | ID: ${borrower.idNumber}`);
    doc.text(`Email: ${borrower.email || "N/A"}`);
    doc.moveDown(1.5);

    // --- Summary Section ---
    const summaryY = doc.y;
    doc.rect(40, summaryY, 515, 60).fill("#f8f9fa").stroke("#27ae60");
    
    doc.fillColor("#7f8c8d").fontSize(8).font("Helvetica").text("TOTAL CLEARED", 60, summaryY + 15);
    doc.fillColor("#2c3e50").fontSize(14).font("Helvetica-Bold").text(`${totalLoansCleared} Loans`, 60, summaryY + 28);

    doc.fillColor("#7f8c8d").fontSize(8).font("Helvetica").text("TOTAL PRINCIPAL", 220, summaryY + 15);
    doc.fillColor("#2c3e50").fontSize(14).font("Helvetica-Bold").text(`KES ${totalPrincipalPaid.toLocaleString()}`, 220, summaryY + 28);

    doc.fillColor("#7f8c8d").fontSize(8).font("Helvetica").text("TOTAL PAID BACK", 380, summaryY + 15);
    doc.fillColor("#27ae60").fontSize(14).font("Helvetica-Bold").text(`KES ${totalOverallPaid.toLocaleString()}`, 380, summaryY + 28);

    doc.y = summaryY + 85;
    doc.fontSize(14).fillColor("#2c3e50").font("Helvetica-Bold").text("Detailed Loan History");
    doc.moveDown(1);

    // --- Detailed History Blocks ---
    formattedLoans.forEach((loan, idx) => {
      if (doc.y > 600) doc.addPage();

      const loanStart = doc.y;
      doc.rect(40, loanStart, 515, 25).fill("#fafbfc");
      doc.fillColor("#2c3e50").fontSize(10).font("Helvetica-Bold").text(`Loan #${idx + 1} Summary`, 50, loanStart + 8);
      doc.fillColor("#27ae60").text("✔ FULLY SETTLED", 460, loanStart + 8);

      let currentY = loanStart + 35;
      doc.fontSize(9);
      
      const drawInfoRow = (l1, v1, l2, v2) => {
        doc.fillColor("#7f8c8d").font("Helvetica").text(l1, 50, currentY);
        doc.fillColor("#2c3e50").font("Helvetica-Bold").text(v1, 120, currentY);
        doc.fillColor("#7f8c8d").font("Helvetica").text(l2, 300, currentY);
        doc.fillColor("#2c3e50").font("Helvetica-Bold").text(v2, 370, currentY);
        currentY += 15;
      };

      drawInfoRow("Issue Date:", loan.issueDate ? new Date(loan.issueDate).toLocaleDateString("en-GB") : "N/A", "Due Date:", loan.dueDate ? new Date(loan.dueDate).toLocaleDateString("en-GB") : "N/A");
      drawInfoRow("Principal:", `KES ${loan.amount?.toLocaleString()}`, "Interest:", `KES ${loan.interest?.toLocaleString()}`);
      drawInfoRow("Settlement:", loan.lastPaymentDate ? new Date(loan.lastPaymentDate).toLocaleDateString("en-GB") : "N/A", "Total Paid:", `KES ${loan.totalPaid?.toLocaleString()}`);

      currentY += 10;
      doc.fontSize(8).fillColor("#95a5a6").font("Helvetica-Bold").text("REPAYMENT HISTORY", 50, currentY, { characterSpacing: 1 });
      currentY += 15;

      doc.rect(50, currentY, 495, 15).fill("#f8f9fa");
      doc.fillColor("#95a5a6").fontSize(7).font("Helvetica-Bold").text("DATE", 60, currentY + 4, { width: 100, align: 'left' });
      doc.text("REFERENCE", 180, currentY + 4, { width: 250, align: 'left' });
      doc.text("AMOUNT", 450, currentY + 4, { width: 85, align: 'right' });
      currentY += 15;

      loan.repayments.forEach((r) => {
        if (currentY > 750) {
            doc.addPage();
            currentY = 50;
        }
        doc.fillColor("#2c3e50").fontSize(8).font("Helvetica").text(new Date(r.date).toLocaleDateString("en-GB"), 60, currentY + 4, { width: 100, align: 'left' });
        doc.text(r.accountReference || r._id.toString().slice(-8).toUpperCase(), 180, currentY + 4, { width: 250, align: 'left' });
        doc.font("Helvetica-Bold").text(`KES ${r.amount?.toLocaleString()}`, 450, currentY + 4, { width: 85, align: 'right' });
        doc.strokeColor("#edf2f7").lineWidth(0.5).moveTo(50, currentY + 15).lineTo(545, currentY + 15).stroke();
        currentY += 15;
      });

      doc.y = currentY + 20;
    });

    // --- Footer ---
    const footerY = Math.max(doc.y + 20, 780);
    doc.y = footerY;
    doc.fontSize(8).fillColor("#bdc3c7").font("Helvetica").text("This is an automated report from iziFinance. All listed loans are verified as fully settled.", { align: "center" });
    doc.text(`© ${new Date().getFullYear()} iziFinance | Empowerment Through Access`, { align: "center" });

    doc.end();

  } catch (error) {
    console.error("Settlement Report PDF generation error (PDFKit):", error);
    res.status(500).json({
      message: "Failed to generate settlement report",
      error: error.message,
    });
  }
};

exports.generateLoanReceiptPDF = async (req, res) => {
  try {
    const { loanId } = req.params;

    const loan = await Loan.findById(loanId).populate("borrowerId");

    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }

    const totalPaid = loan.repayments?.reduce((sum, r) => sum + (r.amount || 0), 0) || 0;
 
    const doc = new PDFDocument({ size: "A4", margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=loan_receipt_${loanId}.pdf`);
    doc.pipe(res);

    // --- Header & Logo ---
    const logoFilePath = path.join(__dirname, "../assets/izi-logo.png");
    if (fs.existsSync(logoFilePath)) {
      doc.image(logoFilePath, (doc.page.width - 120) / 2, 30, { width: 120 });
      doc.y = 110; 
    } else {
      doc.y = 50;
    }

    doc.fontSize(16).fillColor("#2c3e50").font("Helvetica-Bold").text("LOAN CLEARANCE RECEIPT", { align: "center" });
    doc.fontSize(10).fillColor("#27ae60").text("✔ This loan has been successfully cleared.", { align: "center" });
    doc.moveDown(2);

    // --- Borrower Info ---
    doc.fillColor("#2c3e50").fontSize(12).font("Helvetica-Bold").text(`Borrower: ${loan.borrowerId?.fullName || loan.fullName || "User"}`);
    doc.strokeColor("#eee").lineWidth(1).moveTo(40, doc.y + 5).lineTo(555, doc.y + 5).stroke();
    doc.moveDown(1.5);

    // --- Loan Summary Table ---
    const summaryTop = doc.y;
    doc.fillColor("#f8f9fa").rect(40, summaryTop, 515, 20).fill();
    
    doc.fontSize(8).fillColor("#444").font("Helvetica-Bold");
    doc.text("Loan Amount", 40, summaryTop + 6, { width: 90, align: 'center' });
    doc.text("Interest", 130, summaryTop + 6, { width: 80, align: 'center' });
    doc.text("Total Paid", 210, summaryTop + 6, { width: 90, align: 'center' });
    doc.text("Issued", 300, summaryTop + 6, { width: 85, align: 'center' });
    doc.text("Due", 385, summaryTop + 6, { width: 85, align: 'center' });
    doc.text("Status", 470, summaryTop + 6, { width: 80, align: 'center' });

    doc.fontSize(9).font("Helvetica").fillColor("#2c3e50");
    const valY = summaryTop + 25;
    doc.text(`KES ${loan.amount?.toLocaleString()}`, 40, valY, { width: 90, align: 'center' });
    doc.text(`KES ${loan.interest?.toLocaleString()}`, 130, valY, { width: 80, align: 'center' });
    doc.text(`KES ${totalPaid.toLocaleString()}`, 210, valY, { width: 90, align: 'center' });
    doc.text(loan.issueDate ? new Date(loan.issueDate).toLocaleDateString("en-GB") : "N/A", 300, valY, { width: 85, align: 'center' });
    doc.text(loan.dueDate ? new Date(loan.dueDate).toLocaleDateString("en-GB") : "N/A", 385, valY, { width: 85, align: 'center' });
    doc.fillColor("#27ae60").font("Helvetica-Bold").text(loan.status === 'fully paid' ? 'Paid' : loan.status, 470, valY, { width: 80, align: 'center' });

    doc.moveDown(3);

    // --- Repayment History ---
    doc.fontSize(12).fillColor("#2c3e50").font("Helvetica-Bold").text("Repayment History");
    doc.moveDown(0.5);

    const historyTop = doc.y;
    doc.fillColor("#f8f9fa").rect(40, historyTop, 515, 20).fill();
    doc.fontSize(8).fillColor("#444").font("Helvetica-Bold");
    doc.text("DATE", 40, historyTop + 6, { width: 100, align: 'center' });
    doc.text("AMOUNT PAID", 140, historyTop + 6, { width: 250, align: 'center' });
    doc.text("STATUS", 440, historyTop + 6, { width: 110, align: 'center' });

    let rowY = historyTop + 20;
    if (loan.repayments?.length) {
      loan.repayments.forEach((r) => {
        if (rowY > 750) {
            doc.addPage();
            rowY = 50;
        }
        doc.fontSize(9).font("Helvetica").fillColor("#2c3e50");
        doc.text(new Date(r.date).toLocaleDateString("en-GB"), 40, rowY + 6, { width: 100, align: 'center' });
        doc.text(`KES ${r.amount?.toLocaleString()}`, 140, rowY + 6, { width: 250, align: 'center' });
        doc.text("On Time", 440, rowY + 6, { width: 110, align: 'center' });
        doc.strokeColor("#eee").lineWidth(0.5).moveTo(40, rowY + 20).lineTo(555, rowY + 20).stroke();
        rowY += 20;
      });
    } else {
      doc.fontSize(9).font("Helvetica").fillColor("#bdc3c7").text("No repayment history found", 50, rowY + 6, { align: "center", width: 515 });
    }

    // --- Footer ---
    const footerY = Math.max(rowY + 40, 780);
    doc.y = footerY;
    doc.fontSize(8).fillColor("#7f8c8d").font("Helvetica").text("This is an automated report from iziFinance. All details are verified as correct.", { align: "center" });
    doc.text(`© ${new Date().getFullYear()} iziFinance | Empowerment Through Access`, { align: "center" });

    doc.end();

  } catch (error) {
    console.error("Loan Receipt PDF generation error (PDFKit):", error);
    res.status(500).json({
      message: "Failed to generate loan receipt PDF",
      error: error.message,
    });
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
  try {
    const loans = await Loan.find({
      loanRequestStatus: "approved",
      status: "fully paid"
    }).populate("borrowerId");

    // ✅ Calculate total fully paid amount
    let totalFullyPaidAmount = 0;

    // Count fully paid loans per borrower
    const loanCountMap = {};

    loans.forEach((loan) => {
      const borrowerId = loan.borrowerId?._id?.toString();
      if (!borrowerId) return;

      // Count loans per borrower
      loanCountMap[borrowerId] =
        (loanCountMap[borrowerId] || 0) + 1;

      // Sum total repayment amount
      totalFullyPaidAmount += loan.totalRepayment || 0;
    });

    // Add fullyPaidLoanCount inside borrower data
    const updatedLoans = loans.map((loan) => {
      const loanObj = loan.toObject();

      if (loanObj.borrowerId && loanObj.borrowerId._id) {
        const borrowerId = loanObj.borrowerId._id.toString();
        loanObj.borrowerId.fullyPaidLoanCount =
          loanCountMap[borrowerId] || 0;
      }

      return loanObj;
    });

    // Unique customers
    const totalCustomers = Object.keys(loanCountMap).length;

    res.status(200).json({
      totalCustomers,
      totalFullyPaidAmount, // ✅ replaced totalLoansPaid
      loans: updatedLoans
    });

  } catch (error) {
    console.error("Error fetching fully paid loans:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/* =====================================================
   5️⃣ GET FULLY PAID LOANS BY CUSTOMER
===================================================== */
exports.getFullyPaidLoansByCustomer = async (req, res) => {
  try {
    const { borrowerId } = req.params;

    const loans = await Loan.find({
      borrowerId,
      status: "fully paid"
    }).populate("repayments"); // assuming you store payments separately

    let totalPaidAmount = 0;
    let latestPaidDate = null;

    const updatedLoans = loans.map((loan) => {
      const loanObj = loan.toObject();

      // Total paid calculation (assuming loan has totalPaid field OR repayments array)
      let loanTotalPaid = 0;
      let lastPaymentDate = null;

      if (loanObj.repayments && loanObj.repayments.length > 0) {
        loanObj.repayments.forEach((payment) => {
          loanTotalPaid += payment.amount || 0;

          if (!lastPaymentDate || new Date(payment.date) > new Date(lastPaymentDate)) {
            lastPaymentDate = payment.date;
          }
        });
      }

      totalPaidAmount += loanTotalPaid;

      if (!latestPaidDate || new Date(lastPaymentDate) > new Date(latestPaidDate)) {
        latestPaidDate = lastPaymentDate;
      }

      // Add required new fields (without removing old ones)
      loanObj.loanDisbursedDate = loanObj.disbursedAt || loanObj.createdAt || null;
      loanObj.allPaymentsDoneDate = lastPaymentDate || null;
      loanObj.loanClosedDate = loanObj.closedAt || lastPaymentDate || null;

      return loanObj;
    });

    res.status(200).json({
      totalLoansCount: loans.length,
      totalPaidAmount,
      paidOnDate: latestPaidDate,
      loans: updatedLoans
    });

  } catch (error) {
    console.error("Error fetching fully paid loans by customer:", error);
    res.status(500).json({ message: "Server error" });
  }
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
      loanRequestStatus: "approved",
      status: { $in: ["active", "overdue", "fully paid"] },
      isDeleted: { $ne: true },
      isWrittenOff: { $ne: true }
    }).populate("borrowerId"); // ✅ IMPORTANT

    const borrowerMap = {};

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const today = new Date();

    let totalLoanAmount = 0;
    let totalCollectedAmount = 0;
    let totalActiveLoanCount = 0;
    let totalOverdueLoanCount = 0;
    let totalBalance = 0;

    const paidToday = [];
    const notPaidToday = [];

    loans.forEach((loan) => {
      if (!loan.borrowerId) return; // safety

      const borrowerId = loan.borrowerId._id.toString();

      if (!borrowerMap[borrowerId]) {
        borrowerMap[borrowerId] = {
          borrower: loan.borrowerId,
          loanCount: 0,
          loans: []
        };
      }

      borrowerMap[borrowerId].loanCount++;

      /* ================= TOTAL LOAN AMOUNT ================= */
      totalLoanAmount += loan.totalRepayment || 0;

      /* ================= TOTAL COLLECTED ================= */
      const collectedFromRepayments = Array.isArray(loan.repayments)
        ? loan.repayments.reduce((sum, r) => sum + (r.amount || 0), 0)
        : 0;

      totalCollectedAmount += collectedFromRepayments;

      /* ================= TOTAL BALANCE ================= */
      totalBalance += loan.balance || 0;

      /* ================= STATUS COUNTS ================= */
      if (loan.status === "active") totalActiveLoanCount++;
      if (loan.status === "overdue") totalOverdueLoanCount++;

      /* ---------------- LAST PAYMENT ---------------- */
      let lastPaymentDate = null;
      let paidTodayFlag = false;

      if (loan.repayments?.length) {
        const lastPayment = [...loan.repayments].sort(
          (a, b) => new Date(b.date) - new Date(a.date)
        )[0];

        if (lastPayment?.date) {
          lastPaymentDate = lastPayment.date;

          paidTodayFlag =
            new Date(lastPayment.date) >= startOfToday &&
            new Date(lastPayment.date) <= endOfToday;
        }
      }

      /* ---------------- EXPECTED DAILY AMOUNT ---------------- */
      const expectedDailyAmount = loan.dailyRepayment || 0;

      /* ---------------- STATUS BADGE (OLD STYLE) ---------------- */
      let statusBadge = "On Track";

      const isOverdue =
        loan.balance > 0 && new Date(loan.dueDate) < today;

      if (isOverdue || loan.status === "overdue") {
        statusBadge = "Overdue";
      } else if (!paidTodayFlag && loan.status !== "fully paid") {
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
      } else if (loan.status !== "fully paid") {
        notPaidToday.push(tabRow);
      }
    });

    return res.status(200).json({
      success: true,
      totalBorrowers: Object.keys(borrowerMap).length,
      summary: {
        totalLoanAmount,
        totalCollectedAmount,
        totalBalance,
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
    const { borrowerId, amount, totalInterest, duration, repaymentFrequency } = req.body;

    // ✅ Validation
    if (!borrowerId || !amount || !totalInterest || !duration || !repaymentFrequency) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // ✅ Check borrower existence
    const borrower = await Customer.findById(borrowerId);
    if (!borrower) return res.status(404).json({ message: "Borrower not found" });

    if (borrower.is_blocked) {
      return res.status(403).json({ message: "Borrower is manually blocked" });
    }

    // ✅ Fetch Agent and its assigned Lender
    const agent = await AgentModel.findById(agentId);
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    const lender = await User.findById(agent.lenderId);
    if (!lender) return res.status(404).json({ message: "Assigned lender not found" });

    // ✅ Check if borrower already has active, pending, or overdue loan
    const existingLoan = await Loan.findOne({
      borrowerId,
      status: { $in: ["active", "overdue"] }
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

    // ✅ Eligibility check
    const eligibility = evaluateLoanByCreditScore({
      creditScore: borrower.creditScore || 500,
      requestedAmount: Number(amount),
      borrower
    });

    if (!eligibility.allowed) {
      return res.status(403).json({
        success: false,
        message: `Loan request rejected: ${eligibility.reason || "Credit limit exceeded"}`,
        maxEligibleAmount: eligibility.approvedAmount
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
      repaymentPlan: repaymentFrequency,
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
      const borrowerData = borrower.toObject();
      delete borrowerData._id; // Prevent overwriting loan ID
      Object.assign(loan._doc, borrowerData);
    }
  });


  res.json({ loans });
};


/* =====================================================
   1️⃣1️⃣ REVIEW LOAN REQUEST
===================================================== */
// exports.reviewLoanRequest = async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const { loanId, action } = req.body;
//     const lenderId = req.user._id;


//     /* ===============================
//        1️⃣ BASIC VALIDATION
//     =============================== */
//     if (!loanId || !action) {
//       throw new Error("loanId and action are required");
//     }

//     if (!["approved", "rejected"].includes(action)) {
//       throw new Error("action must be 'approved' or 'rejected'");
//     }





//     /* ===============================
//        2️⃣ FETCH LOAN
//     =============================== */
//     const loan = await Loan.findById(loanId)
//       .populate("borrowerId")
//       .populate("requestedByAgentId")
//       .populate("lenderId")
//       .session(session);

//     if (!loan) {
//       throw new Error("Loan not found");
//     }

//     /* ===============================
//        3️⃣ AUTHORIZATION
//     =============================== */
//     if (loan.lenderId._id.toString() !== lenderId.toString()) {
//       throw new Error("Unauthorized review attempt");
//     }

//     if (loan.loanRequestStatus !== "pending") {
//       throw new Error(`Loan already ${loan.loanRequestStatus}`);
//     }

//     const borrower = loan.borrowerId;
//     const agent = loan.requestedByAgentId;
//     const lender = loan.lenderId;


//     /* 🔒 COMPANY KYC RESTRICTION */
// if (
//   lender.accountType === "company" &&
//   lender.kycStatus !== "approved"
// ) {
//   throw new Error("Company KYC not approved. Cannot approve loan.");
// }

//     /* ===============================
//        4️⃣ REJECTION FLOW
//     =============================== */
//     if (action === "rejected") {
//       loan.loanRequestStatus = "rejected";
//       await loan.save({ session });

//       await session.commitTransaction();
//       session.endSession();

//       return res.status(200).json({
//         message: "Loan rejected successfully",
//         loanId: loan._id
//       });
//     }

//     /* ===============================
//        5️⃣ CREDIT SCORE RULES
//     =============================== */
//   const creditScore = borrower.creditScore || loan.creditScoreAfter || 500;


// // first-time borrower check
// const isFirstLoan =
//   (borrower.totalLoans || 0) === 0 &&
//   (borrower.completedLoans || 0) === 0;

// // ❌ Reject ONLY if:
// //  - creditScore < 600
// //  - AND NOT first loan
// if (creditScore < 600 && !isFirstLoan) {
//   loan.loanRequestStatus = "rejected";
//   await loan.save({ session });

//   await session.commitTransaction();
//   session.endSession();

//   return res.status(400).json({
//     message: "Loan rejected due to low credit score",
//     creditScore,
//     isFirstLoan
//   });
// }

// // ⭐ Bonus for very high score
// if (creditScore >= 800) {
//   loan.amount = Math.round(loan.amount * 1.2);
//   loan.totalRepayment = loan.amount + loan.interest;
//   loan.balance = loan.totalRepayment;
// }

//     /* ===============================
//        6️⃣ LENDER WALLET CHECK
//     =============================== */
// /* ===============================
//    6️⃣ LENDER WALLET CHECK (AMOUNT + FEE)
// =============================== */
// const estimatedFee = getB2CCharge(Number(loan.amount));
// const totalDebit = Number(loan.amount) + estimatedFee;

// if (lender.walletBalance < totalDebit) {
//   throw new Error(
//     `Insufficient wallet balance. Required: ${totalDebit}`
//   );
// }


//     /* ===============================
//        7️⃣ APPROVE LOAN (NOT ACTIVE YET)
//     =============================== */
//     loan.loanRequestStatus = "approved";
//     loan.status = "pending"; // will become active after B2C callback
//     loan.issuedByLenderId = lenderId;

//     await loan.save({ session });

//     /* ===============================
//        8️⃣ CREATE PENDING TRANSACTION
//     =============================== */
//     const [transaction] = await Transaction.create(
//       [
//         {
//           userId: lenderId,
//           userModel: "User",
//           loanId: loan._id,
//           type: "loan issued",
//           amount: loan.amount,
//           status: "pending",
//           phone: borrower.phone,
//           description: "Loan disbursement",
//           balanceBefore: lender.walletBalance,
//           balanceAfter: lender.walletBalance - loan.amount
//         }
//       ],
//       { session }
//     );

//     /* ===============================
//        9️⃣ AGENT COMMISSION (PENDING)
//     =============================== */
//     if (agent) {
//       await AgentCommission.create(
//         [
//           {
//             agentId: agent._id,
//             loanId: loan._id,
//             commissionType: "approval",
//             amount: loan.amount * 0.0495,
//             status: "pending"
//           }
//         ],
//         { session }
//       );
//     }

//     /* ===============================
//        🔟 INITIATE M-PESA B2C
//     =============================== */
//     const b2cResponse = await initiateB2C(
//       borrower.phone,
//       loan.amount,
//       transaction._id
//     );

//     if (!b2cResponse?.OriginatorConversationID) {
//       throw new Error("Invalid B2C response from M-Pesa");
//     }

//     transaction.checkoutRequestID = b2cResponse.OriginatorConversationID;
//     transaction.conversationID = b2cResponse.ConversationID;
//     await transaction.save({ session });

//     /* ===============================
//        ✅ COMMIT
//     =============================== */
//     await session.commitTransaction();
//     session.endSession();

//     return res.status(200).json({
//       message: "Loan approved — awaiting M-Pesa confirmation",
//       loan: {
//         id: loan._id,
//         amount: loan.amount,
//         status: loan.status,
//         loanRequestStatus: loan.loanRequestStatus
//       },
//       transaction: {
//         id: transaction._id,
//         checkoutRequestID: transaction.checkoutRequestID
//       },
//       b2cResponse
//     });

//   } catch (error) {
//     if (session.inTransaction()) {
//       await session.abortTransaction();
//     }
//     session.endSession();

//     console.error("❌ reviewLoanRequest error:", error);

//     return res.status(500).json({
//       message: error.message
//     });
//   }
// };

exports.reviewLoanRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { loanId, action } = req.body;
    const lenderId = req.user._id;
    console.log("loan id ", loanId)
    if (!loanId || !action) {
      throw new Error("loanId and action are required");
    }

    if (!["approved", "rejected"].includes(action)) {
      throw new Error("action must be 'approved' or 'rejected'");
    }

    /* ===============================
       FETCH LOAN
    =============================== */
    const loan = await Loan.findById(loanId)
      .populate("borrowerId")
      .populate("requestedByAgentId")
      .populate("lenderId")
      .session(session);

    if (!loan) throw new Error("Loan not found");

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
       COMPANY KYC CHECK
    =============================== */
    if (
      lender.accountType === "company" &&
      lender.kycStatus !== "approved"
    ) {
      throw new Error("Company KYC not approved. Cannot approve loan.");
    }

    /* ===============================
       REJECTION FLOW
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
       CREDIT ENGINE EVALUATION
    =============================== */

    const creditScore =
      borrower.creditScore || loan.creditScoreAfter || 500;

    let repaymentRatio = 1;
    let allPaymentsOnTime = false;

    // Fetch last fully paid loan for behavior analysis
    const lastLoan = await Loan.findOne({
      borrowerId: borrower._id,
      status: "fully paid"
    }).sort({ createdAt: -1 });

    if (lastLoan) {
      repaymentRatio =
        lastLoan.repaidAmount / lastLoan.totalRepayment;

      allPaymentsOnTime =
        lastLoan.repayments?.every(r => r.daysLate === 0) || false;
    }

    const eligibility = evaluateLoanByCreditScore({
      creditScore,
      requestedAmount: loan.amount,
      borrower,
      repaymentRatio,
      exposureRatio: 0
    });

    if (!eligibility.allowed) {
      loan.loanRequestStatus = "rejected";
      await loan.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.status(400).json({
        message: eligibility.reason || "Loan rejected",
        creditScore,
        riskLevel: eligibility.riskLevel,
        defaultProbability: eligibility.defaultProbability
      });
    }

    /* ===============================
       HIGH SCORE BONUS
    =============================== */
    if (creditScore >= 800) {
      loan.amount = Math.round(loan.amount * 1.2);
      loan.totalRepayment = loan.amount + loan.interest;
      loan.balance = loan.totalRepayment;
    }

    /* ===============================
       WALLET CHECK (WITH FEE)
    =============================== */
    const estimatedFee = getB2CCharge(Number(loan.amount));
    const totalDebit = Number(loan.amount) + estimatedFee;

    if (lender.walletBalance < totalDebit) {
      throw new Error(
        `Insufficient wallet balance. Required: ${totalDebit}`
      );
    }

    /* ===============================
       APPROVE LOAN
    =============================== */
    loan.loanRequestStatus = "approved";
    loan.status = "pending";
    loan.issuedByLenderId = lenderId;

    await loan.save({ session });

    /* ===============================
       CREATE TRANSACTION
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
       AGENT COMMISSION
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
       INITIATE B2C
    =============================== */
    const b2cResponse = await initiateB2C(
      borrower.phone,
      loan.amount,
      transaction._id
    );

    if (!b2cResponse?.OriginatorConversationID) {
      throw new Error("Invalid B2C response from M-Pesa");
    }

    transaction.checkoutRequestID =
      b2cResponse.OriginatorConversationID;

    transaction.conversationID =
      b2cResponse.ConversationID;

    await transaction.save({ session });

    /* ===============================
       COMMIT
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
      risk: {
        level: eligibility.riskLevel,
        defaultProbability: eligibility.defaultProbability
      }
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

/* =====================================================
   Agent Loan History (Activity Feed)
===================================================== */
exports.getAgentLoanHistory = async (req, res) => {
  try {
    const agentId = req.user._id;
    const loans = await Loan.find({
      requestedByAgentId: agentId
    })
      .populate("borrowerId", "fullName phone email") // Customer details
      .populate("lenderId", "name phone")   // Lender (User) details
      .lean();

    if (!loans.length) {
      return res.status(200).json({
        success: true,
        message: "No loan history found for this agent",
        totalActivities: 0,
        activities: []
      });
    }

    let activities = [];

    loans.forEach(loan => {
      const borrower = loan.borrowerId || {};
      const baseActivity = {
        loanId: loan._id,
        borrowerName: loan.fullName || borrower.fullName,
        amount: loan.amount, // original loan amount
        loanStatus: loan.status,
        requestStatus: loan.loanRequestStatus,
      };

      // 1. loan_requested
      if (loan.createdAt) {
        activities.push({ ...baseActivity, type: "loan_requested", date: loan.createdAt, description: "Loan requested" });
      }

      // 2. loan_approved & 4. loan_issued
      if (loan.loanRequestStatus === "approved") {
        activities.push({ ...baseActivity, type: "loan_approved", date: loan.issueDate || loan.createdAt, description: "Loan approved" });

        // If approved and active/fully paid/overdue, it means it was issued successfully by M-Pesa.
        if (["active", "fully paid", "overdue"].includes(loan.status)) {
          activities.push({ ...baseActivity, type: "loan_issued", date: loan.issueDate || loan.createdAt, description: "Loan successfully issued to borrower" });
        }
      }

      // 3. loan_rejected
      if (loan.loanRequestStatus === "rejected") {
        activities.push({ ...baseActivity, type: "loan_rejected", date: loan.updatedAt, description: "Loan rejected" });
      }

      // 5. repayment_made
      if (loan.repayments && loan.repayments.length > 0) {
        loan.repayments.forEach(rep => {
          activities.push({
            ...baseActivity,
            type: "repayment_made",
            date: rep.date,
            repaymentAmount: rep.amount,
            description: `Repayment of KES ${rep.amount} made`
          });
        });
      }

      // 6. loan_completed
      if (loan.status === "fully paid") {
        activities.push({ ...baseActivity, type: "loan_completed", date: loan.updatedAt, description: "Loan fully paid" });
      }

      // 7. loan_defaulted
      if (loan.isDefaulted) {
        // fallback to dueDate or updatedAt if no precise default timestamp
        activities.push({ ...baseActivity, type: "loan_defaulted", date: loan.dueDate, description: "Loan defaulted" });
      }

      // 8. reminder_sent
      if (loan.lastReminderSent) {
        activities.push({ ...baseActivity, type: "reminder_sent", date: loan.lastReminderSent, description: "Reminder sent to borrower" });
      }
    });

    // Sort activities from newest to oldest
    activities.sort((a, b) => new Date(b.date) - new Date(a.date));

    return res.status(200).json({
      success: true,
      totalActivities: activities.length,
      activities
    });

  } catch (error) {
    console.error("❌ getAgentLoanHistory error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch agent loan history"
    });
  }
};


/* =====================================================
   12️⃣ BORROWER → REQUEST LOAN FROM AGENT
===================================================== */
exports.borrowerRequestLoan = async (req, res) => {
  try {
    const borrowerId = req.borrower._id;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Valid loan amount is required" });
    }

    const borrower = await Customer.findById(borrowerId);
    if (!borrower) return res.status(404).json({ message: "Borrower not found" });

    // 1️⃣ Blocked Check
    if (borrower.is_blocked) {
      return res.status(403).json({
        message: "Your account is currently blocked. Please contact support.",
        reason: borrower.block_reason
      });
    }

    // 2️⃣ Verification Check
    if (!borrower.isVerified) {
      return res.status(403).json({
        message: "Your account is not verified. Please complete your profile to request a loan."
      });
    }

    // 3️⃣ Eligibility Check
    const eligibility = evaluateLoanByCreditScore({
      creditScore: borrower.creditScore || 500,
      requestedAmount: Number(amount),
      borrower
    });

    if (!eligibility.allowed) {
      return res.status(403).json({
        success: false,
        message: `Loan request rejected: ${eligibility.reason || "Credit limit exceeded"}`,
        maxEligibleAmount: eligibility.approvedAmount
      });
    }


    // 4️⃣ Outstanding Loan Check (Ensuring all previous loans are fully paid)
    const existingLoan = await Loan.findOne({
      borrowerId,
      status: { $in: ["pending", "active", "overdue"] },
      loanRequestStatus: { $nin: ["rejected", "agent_rejected"] }
    });

    const agentId = borrower.assignedAgent || borrower.agentId;
    if (!agentId) {
      return res.status(400).json({ message: "You don't have an assigned agent. Please contact support." });
    }

    const agent = await AgentModel.findById(agentId);
    if (!agent) return res.status(404).json({ message: "Assigned agent not found" });

    if (existingLoan) {

      return res.status(400).json({
        message: "You cannot request a new loan until your current loan is fully paid or your pending request is processed.",
        status: existingLoan.status,
        requestStatus: existingLoan.loanRequestStatus
      });
    }

    const loan = await Loan.create({
      lenderId: agent.lenderId, // Placeholder, will be confirmed by Agent
      borrowerId,
      requestedByAgentId: agentId,
      fullName: borrower.fullName,
      phoneNumber: borrower.phone,
      amount,
      status: "pending",
      loanRequestStatus: "borrower_pending"
    });

    // Notify Agent
    await Notification.create({
      userId: agent._id,
      userModel: "Agent",
      title: "New Loan Request from Borrower",
      message: `${borrower.fullName} has requested a loan of KES ${amount}. Review the request.`,
      type: "loan"
    });

    return res.status(201).json({
      success: true,
      message: "Loan request sent to your agent successfully.",
      loan
    });

  } catch (error) {
    console.error("❌ borrowerRequestLoan error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* =====================================================
   13️⃣ AGENT → GET BORROWER LOAN REQUESTS
===================================================== */
exports.getBorrowerLoanRequests = async (req, res) => {
  try {
    const agentId = req.user._id;

    const requests = await Loan.find({
      requestedByAgentId: agentId,
      loanRequestStatus: "borrower_pending"
    }).populate("borrowerId", "fullName phone email creditScore");

    return res.status(200).json({
      success: true,
      requests
    });

  } catch (error) {
    console.error("❌ getBorrowerLoanRequests error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* =====================================================
   14️⃣ AGENT → ACTION ON BORROWER REQUEST
===================================================== */
exports.agentActionOnBorrowerRequest = async (req, res) => {
  try {
    const agentId = req.user._id;
    const { loanId, action, rejectReason, totalInterest, duration, repaymentPlan } = req.body;

    if (!loanId || !action) {
      return res.status(400).json({ message: "loanId and action are required" });
    }

    const loan = await Loan.findById(loanId).populate("borrowerId");
    if (!loan) return res.status(404).json({ message: "Loan request not found" });

    if (loan.requestedByAgentId.toString() !== agentId.toString()) {
      return res.status(403).json({ message: "Unauthorized action" });
    }

    if (loan.loanRequestStatus !== "borrower_pending") {
      return res.status(400).json({ message: `Request is already ${loan.loanRequestStatus}` });
    }

    if (action === "rejected") {
      loan.loanRequestStatus = "agent_rejected";
      loan.rejectReason = rejectReason || "Rejected by agent";
      await loan.save();

      // Notify Borrower
      await Notification.create({
        userId: loan.borrowerId?._id,
        userModel: "Customer",
        title: "Loan Request Rejected",
        message: `Your loan request for KES ${loan.amount} was rejected by your agent. Reason: ${loan.rejectReason}`,
        type: "loan_rejected"
      });

      return res.status(200).json({ success: true, message: "Loan request rejected." });
    }

    if (action === "approved") {
      if (!totalInterest || !duration || !repaymentPlan) {
        return res.status(400).json({ message: "Interest, duration and repayment plan are required for approval" });
      }

      const totalRepayment = parseFloat(loan.amount) + parseFloat(totalInterest);
      const dailyRepayment = totalRepayment / duration; // Simplified, assuming daily for calculation reference

      loan.interest = totalInterest;
      loan.duration = duration;
      loan.repaymentPlan = repaymentPlan;
      loan.totalRepayment = totalRepayment;
      loan.dailyRepayment = dailyRepayment;
      loan.balance = totalRepayment;
      loan.dueDate = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);
      loan.loanRequestStatus = "pending"; // Now visible to Lender
      loan.billRefNumber = loan.borrowerId.idNumber;

      await loan.save();

      // Notify Lender
      await Notification.create({
        userId: loan.lenderId,
        userModel: "User",
        title: "New Loan Request (from Agent)",
        message: `Agent ${req.user.name} has approved and forwarded a loan request for ${loan.fullName} of KES ${loan.amount}.`,
        type: "loan"
      });

      // Notify Borrower
      await Notification.create({
        userId: loan.borrowerId?._id,
        userModel: "Customer",
        title: "Loan Request Updated",
        message: `Your agent has reviewed and forwarded your loan request for KES ${loan.amount} to the lender.`,
        type: "loan"
      });

      return res.status(200).json({ success: true, message: "Loan request approved and forwarded to lender.", loan });
    }

    return res.status(400).json({ message: "Invalid action" });

  } catch (error) {
    console.error("❌ agentActionOnBorrowerRequest error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

