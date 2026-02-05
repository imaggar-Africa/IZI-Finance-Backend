const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Loan = require("../models/Loan");
const Customer = require("../models/customer");  
const Notification = require("../models/Notification");
const mongoose = require("mongoose");
const { reverseTransaction } = require("../utils/mpesa");
const { sendSMS } = require("../utils/sms");
const AgentCommission = require('../models/AgentCommission');
const Profile = require("../models/Profile");
const AgentModel = require("../models/AgentModel");
const { recalculateCreditScore } = require("../utils/creditScore");


// Single callback for all STK Push transactions


// ✅ STK Callback Controller

// exports.stkCallback = async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const callbackData = req.body;
//     console.log("📥 STK Callback Received:", JSON.stringify(callbackData, null, 2));

//     const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } =
//       callbackData?.Body?.stkCallback || {};

//     if (!CheckoutRequestID) throw new Error("CheckoutRequestID missing in callback");

//     /* ===============================
//        EXTRACT AMOUNT + RECEIPT
//     =============================== */
//     let Amount = 0;
//     let MpesaReceiptNumber = "";

//     if (CallbackMetadata?.Item) {
//       CallbackMetadata.Item.forEach(item => {
//         if (item.Name === "Amount") Amount = item.Value;
//         if (item.Name === "MpesaReceiptNumber") MpesaReceiptNumber = item.Value;
//       });
//     }

//     /* ===============================
//        FIND TRANSACTION
//     =============================== */
//     const transaction = await Transaction.findOne({
//       checkoutRequestID: CheckoutRequestID
//     }).session(session);

//     if (!transaction) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(404).json({ message: "Transaction not found" });
//     }

//     // Prevent duplicate callback
//     if (transaction.status === "successful") {
//       await session.commitTransaction();
//       session.endSession();
//       return res.status(200).json({ message: "Duplicate callback ignored" });
//     }

//     /* ===============================
//        HANDLE FAILED MPESA
//     =============================== */
//     if (ResultCode !== 0) {
//       transaction.status = "failed";
//       transaction.failureReason = ResultDesc;
//       transaction.mpesaPayload = callbackData;
//       await transaction.save({ session });

//       await session.commitTransaction();
//       session.endSession();
//       return res.status(200).json({ message: "Payment failed handled" });
//     }

//     /* ===============================
//        MARK TRANSACTION SUCCESS
//     =============================== */
//     transaction.status = "successful";
//     transaction.transactionId = MpesaReceiptNumber || transaction.transactionId;

//     /* ===============================
//        REPAYMENT FLOW
//     =============================== */
//     if (transaction.type === "repayment") {

//       const borrower = await Customer.findById(transaction.userId).session(session);
//       const loan = await Loan.findById(transaction.loanId).session(session);

//       if (!borrower || !loan) {
//         throw new Error("Borrower or Loan not found");
//       }

//       transaction.balanceBefore = loan.balance;

//       loan.repaidAmount += Number(Amount);
//       loan.balance -= Number(Amount);

//       let isFullyRepaid = false;
//       if (loan.balance <= 0) {
//         loan.balance = 0;
//         loan.status = "fully paid";
//         isFullyRepaid = true;
//       }

//       loan.repayments.push({
//         amount: Number(Amount),
//         transactionId: transaction.transactionId,
//         date: new Date()
//       });

//       await loan.save({ session });

//       /* ===============================
//          ADD REPAYMENT TO LENDER WALLET
//       =============================== */
//       const lender = await User.findById(loan.lenderId).session(session);
//       if (lender) {
//         lender.walletBalance += Number(Amount);
//         await lender.save({ session });
//       }

//       borrower.loanBalance = loan.balance;
//       transaction.balanceAfter = loan.balance;

//       /* =====================================================
//          ⭐ CREDIT SCORE UPDATE (EVERY REPAYMENT)
//       ===================================================== */
//       let event = "ON_TIME";
//       let daysLate = 0;

//       if (loan.dueDate && new Date() > loan.dueDate) {
//         event = "LATE";
//         daysLate = Math.ceil(
//           (new Date() - loan.dueDate) / (1000 * 60 * 60 * 24)
//         );
//       }

//       const { newScore, scoreDelta } = await recalculateCreditScore({
//         currentScore: borrower.creditScore || 500,
//         event,
//         daysLate
//       });

//       borrower.creditScore = newScore;
//       borrower.lastScoreUpdate = new Date();
//       borrower.lastCreditScoreChange = {
//         delta: scoreDelta,
//         reason: event === "LATE"
//           ? `Late repayment (${daysLate} days)`
//           : "On-time repayment",
//         date: new Date()
//       };

//       /* ===============================
//          FULL REPAYMENT EXTRA UPDATES
//       =============================== */
//       if (isFullyRepaid) {
//         borrower.completedLoans = (borrower.completedLoans || 0) + 1;
//         borrower.totalLoans = (borrower.totalLoans || 0) + 1;

//         loan.creditScoreAfter = newScore;
//         await loan.save({ session });
//       }

//       await borrower.save({ session });

//       console.log(
//         `📊 CREDIT SCORE UPDATED | Borrower=${borrower._id} | Event=${event} | Δ=${scoreDelta} | New=${newScore}`
//       );
//     }

//     /* ===============================
//        SAVE TRANSACTION
//     =============================== */
//     await transaction.save({ session });

//     await session.commitTransaction();
//     session.endSession();

//     return res.status(200).json({
//       success: true,
//       message: "STK callback processed successfully",
//       transaction
//     });

//   } catch (error) {
//     if (session.inTransaction()) await session.abortTransaction();
//     session.endSession();

//     console.error("❌ STK CALLBACK ERROR:", error);
//     return res.status(500).json({
//       message: "Error processing STK callback",
//       error: error.message
//     });
//   }
// };

exports.stkCallback = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const stk = req.body?.Body?.stkCallback;
    if (!stk?.CheckoutRequestID) {
      throw new Error("CheckoutRequestID missing in callback");
    }

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stk;

    /* ===============================
       EXTRACT AMOUNT + RECEIPT
    =============================== */
    let amount = 0;
    let mpesaReceipt = "";

    if (CallbackMetadata?.Item) {
      CallbackMetadata.Item.forEach(item => {
        if (item.Name === "Amount") amount = Number(item.Value);
        if (item.Name === "MpesaReceiptNumber") mpesaReceipt = item.Value;
      });
    }

    /* ===============================
       FIND TRANSACTION
    =============================== */
    const transaction = await Transaction.findOne({
      checkoutRequestID: CheckoutRequestID
    }).session(session);

    if (!transaction) throw new Error("Transaction not found");

    /* ===============================
       DUPLICATE CALLBACK PROTECTION
    =============================== */
    if (transaction.status === "successful") {
      await session.commitTransaction();
      session.endSession();
      return res.json({ message: "Duplicate callback ignored" });
    }

    /* ===============================
       HANDLE FAILED MPESA
    =============================== */
    if (ResultCode !== 0) {
      transaction.status = "failed";
      transaction.failureReason = ResultDesc;
      transaction.mpesaPayload = req.body;

      await transaction.save({ session });
      await session.commitTransaction();
      session.endSession();

      return res.json({ message: "Payment failed handled" });
    }

    /* ===============================
       MARK TRANSACTION SUCCESS
    =============================== */
    transaction.status = "successful";
    transaction.transactionId = mpesaReceipt || transaction.transactionId;

    /* =====================================================
       CASE 1️⃣ : LOAN ISSUED (B2C SUCCESS)
    ===================================================== */
    if (transaction.type === "loan issued") {
      const loan = await Loan.findById(transaction.loanId).session(session);
      const lender = await User.findById(transaction.userId).session(session);

      if (!loan || !lender) throw new Error("Loan or Lender not found");

      transaction.balanceBefore = lender.walletBalance;
      lender.walletBalance -= amount;
      transaction.balanceAfter = lender.walletBalance;

      await lender.save({ session });

      loan.status = "active";
      await loan.save({ session });
    }

    /* =====================================================
       CASE 2️⃣ : LOAN REPAYMENT
    ===================================================== */
    if (transaction.type === "repayment") {
      const loan = await Loan.findById(transaction.loanId).session(session);
      const borrower = await Customer.findById(transaction.userId).session(session);

      if (!loan || !borrower) throw new Error("Loan or Borrower not found");

      transaction.balanceBefore = loan.balance;

      /* ===============================
         🔥 LATE CHECK + 15% PENALTY
      =============================== */
      let event = "ON_TIME";
      let daysLate = 0;

      if (loan.dueDate && new Date() > loan.dueDate) {
        event = "LATE";
        daysLate = Math.ceil(
          (new Date() - loan.dueDate) / (1000 * 60 * 60 * 24)
        );

        const penalty = Math.ceil(loan.balance * 0.15);
        loan.balance += penalty;
        loan.penaltyAmount = (loan.penaltyAmount || 0) + penalty;

        // 📩 SMS ONLY TO BORROWER
        await sendSMS(
          borrower.phone,
          `Dear ${borrower.fullName},
Your loan payment is late.

Penalty (15%): KES ${penalty}
New total balance: KES ${loan.balance}

Please pay early to avoid more penalties.
- IziFinance`
        );
      }

      /* ===============================
         APPLY REPAYMENT
      =============================== */
      loan.repaidAmount += amount;
      loan.balance -= amount;

      let isFullyRepaid = false;
      if (loan.balance <= 0) {
        loan.balance = 0;
        loan.status = "fully paid";
        isFullyRepaid = true;
      }

      // loan.repayments.push({
      //   amount,
      //   transactionId: transaction.transactionId,
      //   date: new Date()
      // });

      loan.repayments.push({
  transactionId: transaction._id,
  loanId: loan._id,
  borrowerId: borrower._id,
  amount,
  date: new Date(),
  expectedPaymentDate: loan.dueDate,
  wasPaymentLate: event === "LATE",
  daysLate: daysLate,
  creditScoreDelta: scoreDelta || 0
});

      await loan.save({ session });

      // ✅ Credit lender wallet
      const lender = await User.findById(loan.lenderId).session(session);
      if (lender) {
        lender.walletBalance += amount;
        await lender.save({ session });
      }

      borrower.loanBalance = loan.balance;
      transaction.balanceAfter = loan.balance;

      /* ===============================
         CREDIT SCORE (EVERY REPAYMENT)
      =============================== */
      const { newScore, scoreDelta } = await recalculateCreditScore({
        currentScore: borrower.creditScore || 500,
        event,
        daysLate
      });

      borrower.creditScore = newScore;
      borrower.lastScoreUpdate = new Date();
      borrower.lastCreditScoreChange = {
        delta: scoreDelta,
        reason:
          event === "LATE"
            ? `Late repayment (${daysLate} days)`
            : "On-time repayment",
        date: new Date()
      };

      if (isFullyRepaid) {
        borrower.completedLoans = (borrower.completedLoans || 0) + 1;
        borrower.totalLoans = (borrower.totalLoans || 0) + 1;
        loan.creditScoreAfter = newScore;
        await loan.save({ session });

        if (loan.requestedByAgentId) {
          await handleAgentFullRepaymentCommission(
            loan,
            transaction,
            session
          );
        }
      }

      await borrower.save({ session });
    }

    /* ===============================
       SAVE & COMMIT
    =============================== */
    await transaction.save({ session });
    await session.commitTransaction();
    session.endSession();

    return res.json({
      success: true,
      message: "STK callback processed successfully",
      transactionId: transaction._id
    });

  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();

    console.error("❌ STK CALLBACK ERROR:", error);
    return res.status(500).json({
      message: "Error processing STK callback",
      error: error.message
    });
  }
};






// ✅ Agent Commission Handler for Full Repayment
const handleAgentFullRepaymentCommission = async (loan, transaction, session) => {
  try {
    const FIXED_REPAYMENT_COMMISSION = 100;
    
    // Check if commission already exists to prevent duplicates
    const existingCommission = await AgentCommission.findOne({
      agentId: loan.requestedByAgentId,
      loanId: loan._id,
      commissionType: "full_repayment"
    }).session(session);

    if (existingCommission) {
      console.log(`🔄 Full repayment commission already exists for agent ${loan.requestedByAgentId} and loan ${loan._id}`);
      return;
    }

    // Create new commission record
    const commission = new AgentCommission({
      agentId: loan.requestedByAgentId,
      loanId: loan._id,
      commissionType: "full_repayment",
      amount: FIXED_REPAYMENT_COMMISSION,
      status: "earned",
      transactionId: transaction._id,
      earnedAt: new Date()
    });

    await commission.save({ session });
    
    console.log(`💰 Full repayment commission of KES ${FIXED_REPAYMENT_COMMISSION} recorded for agent ${loan.requestedByAgentId}`);

    // ✅ Optional: Add commission to agent's wallet balance here if needed
    const agent = await AgentModel.findById(loan.requestedByAgentId).session(session);
    if (agent) {
      agent.walletBalance += FIXED_REPAYMENT_COMMISSION;
      await agent.save({ session });
      console.log(`💰 Commission added to agent wallet: KES ${FIXED_REPAYMENT_COMMISSION}`);
    }

  } catch (error) {
    console.error("❌ Error handling agent full repayment commission:", error);
    throw error; // Re-throw to be handled by main callback
  }
};

exports.reversalResultHandler = async(req, res) =>{
  console.log("Reversal result received:", req.body);
  // Update transaction.status if needed
  res.status(200).send("Received");
}

exports.reversalTimeoutHandler = async(req, res)=> {
  console.log("Reversal timeout received:", req.body);
  res.status(200).send("Timeout received");
}



