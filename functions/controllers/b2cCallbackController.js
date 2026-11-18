const Transaction = require("../models/Transaction");
const User = require("../models/User");
const Borrower = require("../models/customer");
const Loan = require("../models/Loan");
const Notification = require("../models/Notification");
const mongoose = require("mongoose");
const { sendSMS } = require("../utils/sms");
const AgentCommission = require("../models/AgentCommission");
const AgentModel = require("../models/AgentModel");
const Profile = require("../models/Profile");
const WithdrawRequest = require("../models/WithdrawRequest");
const GroupLoanRequest = require("../models/GroupLoanRequest");
const GroupMember = require("../models/GroupMember");
const Group = require("../models/Group");
const { getB2CCharge } = require("../utils/mpesaCharges");
const groupMonthlyPaymentModel = require("../models/groupMonthlyPaymentModel");
const { notifyUser } = require("../utils/notifyUser");




// Helper function to find nested values in callback

exports.b2cCallback = async (req, res) => {
  console.log("\n📥 B2C CALLBACK RECEIVED");
  console.log("==============================\n");

  let session;
  const postCommitTasks = [];

  try {
    const callback = req.body;
    console.log("📩 Raw Callback Body:", JSON.stringify(callback, null, 2));

    let Result, ResultCode, ResultDesc,
      OriginatorConversationID,
      ConversationID,
      MpesaTransactionID;

    /* ===============================
       CALLBACK PARSING (UNCHANGED)
    =============================== */

    if (callback?.Result) {
      Result = callback.Result;
      ResultCode = Result.ResultCode;
      ResultDesc = Result.ResultDesc;
      OriginatorConversationID = Result.OriginatorConversationID;
      ConversationID = Result.ConversationID;

      if (Result.ResultParameters?.ResultParameter) {
        const resultParams = Result.ResultParameters.ResultParameter;
        if (Array.isArray(resultParams)) {
          const transactionParam = resultParams.find(
            (param) =>
              param.Key === "TransactionID" ||
              param.Key === "TransactionReceipt"
          );
          if (transactionParam) {
            MpesaTransactionID = transactionParam.Value;
          }
        }
      }

      if (!MpesaTransactionID) {
        MpesaTransactionID = Result.TransactionID;
      }
    } else {
      Result = callback;
      ResultCode = callback.ResultCode || callback.resultCode;
      ResultDesc = callback.ResultDesc || callback.resultDesc;
      OriginatorConversationID =
        callback.OriginatorConversationID ||
        callback.originatorConversationID;
      ConversationID =
        callback.ConversationID || callback.conversationID;
      MpesaTransactionID =
        callback.TransactionID ||
        callback.transactionID ||
        callback.MpesaTransactionID;
    }

    /* ===============================
       FIND TRANSACTION
    =============================== */

    let transaction = await Transaction.findOne({
      $or: [
        { checkoutRequestID: OriginatorConversationID },
        { originatorConversationID: OriginatorConversationID },
        { conversationID: ConversationID },
        { conversationID: OriginatorConversationID }
      ]
    });

    if (!transaction) {
      return res.status(200).json({ message: "No transaction found" });
    }

    if (transaction.status !== "pending") {
      return res.status(200).json({ message: "Already processed" });
    }

    /* ===============================
       START SESSION
    =============================== */

    session = await mongoose.startSession();
    session.startTransaction();

    /* ===============================
       FAILURE FLOW
    =============================== */

    if (ResultCode !== 0) {

      transaction.status = "failed";
      transaction.mpesaPayload = Result;
      transaction.failureReason = ResultDesc;

      await transaction.save({ session });

      // 🔥 FIX: update loan properly and refund lender
      if (transaction.type === "loan issued") {
        const loan = await Loan.findById(transaction.loanId).session(session);
        if (loan) {
          loan.loanRequestStatus = "failed"; // ✅ IMPORTANT
          loan.status = "pending";           // non-blocking
          await loan.save({ session });
        }

        // Refund lender wallet on B2C failure
        const lender = await User.findById(transaction.userId).session(session);
        if (lender) {
          const refundAmount = Number(transaction.amount) + Number(transaction.mpesaCharge || 0);
          lender.walletBalance += refundAmount;
          await lender.save({ session });
          console.log(`[B2C_CALLBACK] Refunded KES ${refundAmount} to lender ID: ${lender._id} due to B2C failure.`);
        }
      }

      if (transaction.type === "group loan issued") {
        const request = await GroupLoanRequest.findById(transaction.groupLoanRequestId).session(session);
        if (request) {
          request.status = "pending"; // Reset for retry
          await request.save({ session });

          // 🔔 Push Notification for Group Leader (Failure)
          await Notification.create([{
            userId: request.requestedById,
            userModel: "Customer",
            title: "Loan Disbursement Failed",
            message: `Disbursement to a member in group failed. \nReason: ${ResultDesc}`,
            type: "general"
          }], { session });

          // 🔔 Push Notification for Lender (Failure)
          await Notification.create([{
            userId: transaction.userId,
            userModel: "User",
            title: "Disbursement Failed",
            message: `A group loan disbursement of KES ${transaction.amount} failed.`,
            type: "general"
          }], { session });
        }

        // Refund lender wallet on B2C failure
        const lender = await User.findById(transaction.userId).session(session);
        if (lender) {
          const refundAmount = Number(transaction.amount) + Number(transaction.mpesaCharge || 0);
          lender.walletBalance += refundAmount;
          await lender.save({ session });
          console.log(`[B2C_CALLBACK] Refunded KES ${refundAmount} to lender ID: ${lender._id} due to B2C group failure.`);
        }
      }

      if (transaction.type === "agent withdrawal") {
        const withdrawalRequest = await WithdrawRequest.findById(transaction.withdrawalRequestId)
          .populate("lenderId")
          .session(session);

        if (withdrawalRequest) {
          withdrawalRequest.status = "failed";
          withdrawalRequest.reason = ResultDesc || "M-Pesa B2C callback failed";
          await withdrawalRequest.save({ session });

          // Refund the agent
          const agent = await AgentModel.findById(transaction.userId).session(session);
          if (agent) {
            const agentRefundAmount = Number(transaction.amount);
            const agentBalanceBefore = agent.walletBalance;
            const agentBalanceAfter = agentBalanceBefore + agentRefundAmount;
            
            agent.walletBalance = agentBalanceAfter;
            await agent.save({ session });

            transaction.balanceBefore = agentBalanceBefore;
            transaction.balanceAfter = agentBalanceAfter;
            console.log(`[B2C_CALLBACK] Refunded KES ${agentRefundAmount} to agent ID: ${agent._id} due to B2C failure.`);
          }

          // Refund the lender
          const lender = withdrawalRequest.lenderId;
          if (lender) {
            const refundAmount = Number(transaction.amount) + Number(transaction.mpesaCharge || getB2CCharge(transaction.amount));
            const lenderBalanceBefore = lender.walletBalance;
            const lenderBalanceAfter = lenderBalanceBefore + refundAmount;
            
            lender.walletBalance = lenderBalanceAfter;
            await lender.save({ session });

            // Find lender's withdrawal transaction and mark it as reversed
            const lenderTx = await Transaction.findOne({
              withdrawalRequestId: withdrawalRequest._id,
              userId: lender._id,
              type: "withdrawal"
            }).session(session);

            if (lenderTx) {
              lenderTx.status = "reversed";
              lenderTx.balanceBefore = lenderBalanceBefore;
              lenderTx.balanceAfter = lenderBalanceAfter;
              await lenderTx.save({ session });
            } else {
              // Create a reversal/refund transaction record for the lender if the original was somehow not found
              await Transaction.create(
                [{
                  userId: lender._id,
                  userModel: "User",
                  withdrawalRequestId: withdrawalRequest._id,
                  type: "repayment",
                  amount: refundAmount,
                  status: "successful",
                  phone: lender.phone,
                  balanceBefore: lenderBalanceBefore,
                  balanceAfter: lenderBalanceAfter,
                  accountReference: transaction.accountReference,
                }],
                { session }
              );
            }
            console.log(`[B2C_CALLBACK] Refunded KES ${refundAmount} to lender ID: ${lender._id} due to agent withdrawal B2C failure.`);
          }
        }
      }

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        message: "Transaction failed"
      });
    }


    /* ===============================
       SUCCESS FLOW
    =============================== */

    transaction.status = "successful";
    transaction.mpesaPayload = Result;
    transaction.processedAt = new Date();
    await transaction.save({ session });

    /* ✅ SAFE TRANSACTION ID */

    if (MpesaTransactionID) {
      const existingTx = await Transaction.findOne({
        transactionId: MpesaTransactionID
      }).session(session);

      if (!existingTx) {
        transaction.transactionId = MpesaTransactionID;
      }
    }

    if (
      !transaction.checkoutRequestID &&
      (ConversationID || OriginatorConversationID)
    ) {
      transaction.checkoutRequestID =
        ConversationID || OriginatorConversationID;
    }

    /* =========================================================
       🔥 NEW: LOAN ISSUED SUCCESS HANDLING (ADDED BLOCK)
    ========================================================= */

    if (transaction.type === "loan issued") {
      console.log('[B2C_CALLBACK] Handling loan issued, transaction ID:', transaction._id, 'type:', transaction.type);

      // ✅ Fetch the loan associated with this transaction
      const loan = await Loan.findById(transaction.loanId).session(session);
      console.log('[B2C_CALLBACK] Fetched loan:', loan ? loan._id : 'null');
      
      if (loan) {
        // ✅ FINAL LOAN STATE (Wallet and transaction details were updated at approval time)
        loan.status = "active";
        loan.loanRequestStatus = "approved";
        loan.disbursedAt = new Date();

        await loan.save({ session });

        // 📩 Send 'Loan Issued' Alert SMS (Individual)
        try {
          const borrower = await Borrower.findById(loan.borrowerId).session(session);
          if (borrower && borrower.phone) {
            console.log('[B2C_CALLBACK] Sending SMS to borrower', borrower._id);
            const dueDateStr = loan.dueDate ? new Date(loan.dueDate).toLocaleDateString() : "N/A";
            await sendSMS(
              borrower.phone,
              `IziFinance Loan Alert\nHello ${borrower.fullName}, you have received a loan of KES ${loan.amount}.\nRepayment Amount: KES ${loan.totalRepayment}\nDue Date: ${dueDateStr}\n\nThank you for using IziFinance.`
            );

            // 🔔 Also trigger Push Notification
            await Notification.create({
              userId: borrower._id,
              userModel: "Customer",
              title: "Loan Received",
              message: `Your loan of KES ${loan.amount} has been disbursed.`,
              type: "loan"
            });
          } else {
            console.warn('[B2C_CALLBACK] Borrower not found or missing phone; skipping notifications.');
          }
        } catch (notifErr) {
          console.error('[B2C_CALLBACK] Notification error:', notifErr);
        }

        // Commission handling – only if loan exists and has an agent
        if (loan.requestedByAgentId) {
          const commissionAmount = Number(loan.amount) * 0.0495;

          const commissionUpdate = await AgentCommission.updateOne(
            {
              agentId: loan.requestedByAgentId,
              loanId: loan._id,
              commissionType: "approval"
            },
            {
              status: "earned",
              amount: commissionAmount,
              earnedAt: new Date(),
              transactionId: transaction._id
            },
            { session }
          );

          if (commissionUpdate.modifiedCount > 0) {
            const agent = await AgentModel.findById(loan.requestedByAgentId).session(session);
            if (agent) {
              agent.walletBalance = (agent.walletBalance || 0) + commissionAmount;
              agent.commissionEarned = (agent.commissionEarned || 0) + commissionAmount;
              await agent.save({ session });
              console.log(` Commission added to agent wallet: KES ${commissionAmount}`);
            }
          }
        }
      }
    }

    /* =========================================================
       🔥 NEW: GROUP LOAN ISSUED SUCCESS HANDLING
    ========================================================= */
    if (transaction.type === "group loan issued") {
      const amount = Number(transaction.amount);
      request.status = "approved";

      const member = await GroupMember.findOne({ 
        groupId: request.groupId, 
        borrowerId: request.borrowerId 
      }).session(session);

      if (member) {
        member.internal_loan_amount = amount;
        member.daily_repayment_amount = request.daily_repayment;
        member.remaining_balance = request.total_repayment;
        member.total_repaid = 0;
        member.status = "active";
        await member.save({ session });
      }

      await request.save({ session });

      /* ===============================
         SMS NOTIFICATIONS
      =============================== */
      const group = await Group.findById(request.groupId).session(session);
      const borrower = await Borrower.findById(request.borrowerId).session(session);
      const leader = group?.group_leader_id ? await Borrower.findById(group.group_leader_id).session(session) : null;

      if (borrower) {
        await sendSMS(
          borrower.phone, 
          `Dear ${borrower.fullName}, your group loan of KES ${amount} has been successfully disbursed to your M-Pesa. \nDaily Repayment: KES ${request.daily_repayment}. \nTotal: KES ${request.total_repayment}. \nREF: ${transaction.transactionId || "M-PESA"}`
        );

        // 🔔 Add Push Notification for Borrower
        await Notification.create({
          userId: borrower._id,
          userModel: "Customer",
          title: "Loan Disbursed",
          message: `Your group loan of KES ${amount} has been sent to your M-Pesa.`,
          type: "loan"
        });
      }

      if (leader && leader._id.toString() !== borrower?._id.toString()) {
        await sendSMS(
          leader.phone,
          `Notice: KES ${amount} has been successfully disbursed to group member ${borrower?.fullName} from group ${group?.name || "your group"}.`
        );

        // 🔔 Add Push Notification for Leader
        await Notification.create({
          userId: leader._id,
          userModel: "Customer",
          title: "Loan Successfully Disbursed",
          message: `The loan of KES ${amount} for ${borrower?.fullName} has been successfully disbursed.`,
          type: "loan"
        });
      }

      if (lender) {
        // 🔔 Add Push Notification for Lender
        await Notification.create({
          userId: lender._id,
          userModel: "User",
          title: "Disbursement Complete",
          message: `Your disbursement of KES ${amount} to group member ${borrower?.fullName} was successful.`,
          type: "loan"
        });

        const lenderProfile = await Profile.findOne({ userId: lender._id }).session(session);
        const lenderName = lenderProfile?.fullName || "Lender";
      }

    }

    /* =========================================================
       🔥 NEW: MONTHLY GROUP REPAYMENT B2C CALLBACK
    ========================================================= */
    if (transaction.type === "monthly group repayment") {
      const monthlyPayment = await groupMonthlyPaymentModel.findOne({ 
        transaction_id: transaction._id 
      }).session(session);

      if (monthlyPayment) {
        // We keep 'shortfall' status but we mark the B2C transfer as successful
        // If it was 'pending', we move it to 'paid' (or keep shortfall if applicable)
        if (monthlyPayment.status === "pending") {
          monthlyPayment.status = "paid";
        }
        await monthlyPayment.save({ session });
      }

      const lender = await User.findById(transaction.userId).session(session);
      if (lender) {
          const group = await Group.findById(transaction.groupId).session(session);
          
          if (group) {
            // ♻️ RESET POOL ON SUCCESSFUL CALLBACK
            group.collected_pool_balance = 0;
            await group.save({ session });
            console.log(`♻️ Pool reset for group ${group.name} following successful B2C.`);
          }

          // 📩 Send Confirmation SMS to Lender
          postCommitTasks.push(async () => {
            await sendSMS(
              lender.phone,
              `Dear Lender, your monthly repayment for group ${group?.name || "Group"} of KES ${transaction.amount} has been successfully sent to your M-Pesa. \nREF: ${transaction.transactionId || transaction._id}\n- IziFinance`
            );

            await notifyUser({
              userId: lender._id,
              userModel: "User",
              title: "Monthly Payment Received",
              message: `KES ${transaction.amount} from group ${group?.name} has been disbursed to your M-Pesa.`,
              type: "repayment",
              context: "b2c_monthly_group_repayment",
            });
          });
      }
    }



    /* ===============================
       CUSTOMER WITHDRAWAL LOGIC
    =============================== */

    if (transaction.type === "customer withdrawal") {

      const customer = await Borrower.findById(
        transaction.userId
      ).session(session);

      if (customer) {

        const balanceBefore = Number(customer.savingsBalance || 0);
        const withdrawalAmount = Number(transaction.amount);

        const fee = getB2CCharge(withdrawalAmount);
        const totalDebit = withdrawalAmount + fee;

        if (balanceBefore < totalDebit) {
          throw new Error("Insufficient savings balance");
        }

        const balanceAfter = balanceBefore - totalDebit;

        customer.savingsBalance = balanceAfter;

        transaction.mpesaCharge = fee;
        transaction.balanceBefore = balanceBefore;
        transaction.balanceAfter = balanceAfter;

        await customer.save({ session });

        const customerId = customer._id;
        const customerName = customer.fullName || "Customer";
        const custWithdrawalAmount = withdrawalAmount;
        const custBalanceAfter = balanceAfter;
        const custRef = transaction.transactionId || transaction._id;

        postCommitTasks.push(async () => {
          await notifyUser({
            userId: customerId,
            userModel: "Customer",
            title: "Savings Withdrawal Successful",
            message: `KES ${custWithdrawalAmount} sent to your M-Pesa. New savings balance: KES ${custBalanceAfter}.`,
            type: "withdraw",
            context: "b2c_customer_withdrawal",
          });
          await sendSMS(
            customer.phone,
            `Dear ${customerName}, your savings withdrawal of KES ${custWithdrawalAmount} was processed. New balance: KES ${custBalanceAfter}. REF: ${custRef}\n- IziFinance`
          );
        });
      }
    }

    /* ===============================
       USER WITHDRAWAL LOGIC
    =============================== */

    if (transaction.type === "withdrawal") {
      const user = await User.findById(transaction.userId).session(session);

      if (user) {
        const balanceBefore = Number(user.walletBalance || 0);
        const withdrawalAmount = Number(transaction.amount);

        const fee = getB2CCharge(withdrawalAmount);
        const totalDebit = withdrawalAmount + fee;

        if (balanceBefore < totalDebit) {
          throw new Error("Insufficient wallet balance");
        }

        const balanceAfter = balanceBefore - totalDebit;

        user.walletBalance = balanceAfter;

        transaction.mpesaCharge = fee;
        transaction.balanceBefore = balanceBefore;
        transaction.balanceAfter = balanceAfter;

        await user.save({ session });

        const profile = await Profile.findOne({ userId: user._id }).session(session);
        const userName = profile?.fullName || "User";
        const userId = user._id;
        const userPhone = user.phone;
        const wAmount = withdrawalAmount;
        const wBalanceAfter = balanceAfter;
        const wRef = transaction.transactionId || transaction._id;

        postCommitTasks.push(async () => {
          await notifyUser({
            userId,
            userModel: "User",
            title: "Withdrawal Successful",
            message: `KES ${wAmount} withdrawn from your wallet. New balance: KES ${wBalanceAfter}.`,
            type: "withdraw",
            context: "b2c_user_withdrawal",
          });
          await sendSMS(
            userPhone,
            `Dear ${userName}, your withdrawal of KES ${wAmount} has been processed successfully. \nNew wallet balance: KES ${wBalanceAfter}. \nREF: ${wRef}\n- IziFinance`
          );
        });
      }
    }

    /* =========================================================
       🔥 NEW: AGENT WITHDRAWAL SUCCESS HANDLING
    ========================================================= */
    if (transaction.type === "agent withdrawal") {
      console.log("💰 Processing agent withdrawal callback...");
      
      const agent = await AgentModel.findById(transaction.userId).session(session);

      const withdrawalRequest = await WithdrawRequest.findOne({ 
        transactionId: transaction._id 
      }).populate('lenderId').session(session);

      if (withdrawalRequest) {
        withdrawalRequest.status = "completed";
        await withdrawalRequest.save({ session });
        console.log(`✅ Updated withdrawal request ${withdrawalRequest._id} to completed`);

        // Find and update the lender's withdrawal transaction with the actual M-Pesa receipt ID
        if (MpesaTransactionID) {
          const lenderTx = await Transaction.findOne({
            withdrawalRequestId: withdrawalRequest._id,
            userModel: "User",
            type: "withdrawal"
          }).session(session);

          if (lenderTx) {
            lenderTx.transactionId = MpesaTransactionID;
            await lenderTx.save({ session });
            console.log(`✅ Updated lender transaction ${lenderTx._id} with transactionId: ${MpesaTransactionID}`);
          }
        }
      }

      const agentId = agent?._id;
      const agentName = agent?.name || "Agent";
      const agentPhone = agent?.phone;
      const agentWallet = agent?.walletBalance;
      const txAmount = transaction.amount;
      const txRef = transaction.transactionId || transaction._id;
      const lenderForNotify = withdrawalRequest?.lenderId;

      postCommitTasks.push(async () => {
        if (!agentId) return;

        await notifyUser({
          userId: agentId,
          userModel: "Agent",
          title: "Withdrawal Successful",
          message: `KES ${txAmount} withdrawn successfully. New wallet balance: KES ${agentWallet}.`,
          type: "withdraw",
          context: "b2c_agent_withdrawal",
        });

        await sendSMS(
          agentPhone,
          `Dear ${agentName}, your withdrawal of KES ${txAmount} has been processed successfully. \nNew wallet balance: KES ${agentWallet}. \nREF: ${txRef}\nFunds are on the way to your M-Pesa.\n- IziFinance`
        );

        if (lenderForNotify?._id) {
          await notifyUser({
            userId: lenderForNotify._id,
            userModel: "User",
            title: "Agent Withdrawal Processed",
            message: `Agent ${agentName} has successfully withdrawn KES ${txAmount}.`,
            type: "agent_withdrawal",
            context: "b2c_agent_withdrawal_lender",
          });
        }
      });
    }

    /* ===============================
       FINAL SAVE + COMMIT
    =============================== */

    await transaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Execute post-commit tasks
    if (postCommitTasks.length > 0) {
      await Promise.all(
        postCommitTasks.map((fn) =>
          fn().catch((e) =>
            console.error("[B2C_CALLBACK] post_commit_error", {
              error: e.message,
              stack: e.stack,
            })
          )
        )
      );
    }

    return res.status(200).json({
      message: "B2C callback processed successfully",
      transactionId: transaction._id
    });

  } catch (err) {

    console.error("🔥 B2C CALLBACK ERROR:", err);

    if (session) {
      try {
        if (session.inTransaction()) {
          await session.abortTransaction();
        }
      } finally {
        session.endSession();
      }
    }

    return res.status(500).json({
      error: "Internal server error processing callback",
      details: err.message
    });
  }
};


function findNestedValue(obj, keys) {
  for (const key of keys) {
    if (key.includes('.')) {
      const keyParts = key.split('.');
      let value = obj;
      for (const part of keyParts) {
        value = value?.[part];
        if (value === undefined) break;
      }
      if (value !== undefined) return value;
    } else {
      if (obj?.[key] !== undefined) return obj[key];
    }
  }
  return null;
}

// Helper function to extract amount from callback
function extractAmountFromCallback(callback) {
  try {
    // Check ResultParameters first
    if (callback?.Result?.ResultParameters?.ResultParameter) {
      const params = callback.Result.ResultParameters.ResultParameter;
      if (Array.isArray(params)) {
        const amountParam = params.find(param =>
          param.Key === "TransactionAmount" || param.Key === "Amount"
        );
        if (amountParam) {
          return Number(amountParam.Value);
        }
      }
    }

    // Check direct properties
    if (callback?.TransactionAmount) return Number(callback.TransactionAmount);
    if (callback?.amount) return Number(callback.amount);
    if (callback?.Amount) return Number(callback.Amount);

    return null;
  } catch (error) {
    console.error("Error extracting amount from callback:", error);
    return null;
  }
}








// B2C Callback Handler
// exports.b2cCallback = async (req, res) => {
//   console.log("\n📥 B2C CALLBACK RECEIVED");
//   console.log("==============================\n");

// let session;

//   const postCommitTasks = [];

//   try {
//     const callback = req.body;
//     console.log("📩 Raw Callback Body:", JSON.stringify(callback, null, 2));

//     // ✅ IMPROVED CALLBACK PARSING - Handle ALL M-Pesa B2C formats
//     let Result, ResultCode, ResultDesc, OriginatorConversationID, ConversationID, MpesaTransactionID;

//     // FORMAT 1: Standard M-Pesa B2C Callback Format
//     if (callback?.Result) {
//       console.log("🔧 Detected Format 1: Standard B2C Callback");
//       Result = callback.Result;
//       ResultCode = Result.ResultCode;
//       ResultDesc = Result.ResultDesc;
//       OriginatorConversationID = Result.OriginatorConversationID;
//       ConversationID = Result.ConversationID;

//       // Extract TransactionID from ResultParameters if available
//       if (Result.ResultParameters && Result.ResultParameters.ResultParameter) {
//         const resultParams = Result.ResultParameters.ResultParameter;
//         if (Array.isArray(resultParams)) {
//           const transactionParam = resultParams.find(param => 
//             param.Key === "TransactionID" || param.Key === "TransactionReceipt"
//           );
//           if (transactionParam) {
//             MpesaTransactionID = transactionParam.Value;
//           }
//         }
//       }

//       // Fallback to direct TransactionID
//       if (!MpesaTransactionID) {
//         MpesaTransactionID = Result.TransactionID;
//       }
//     }
//     // FORMAT 2: Direct properties (Manual testing format)
//     else if (callback?.ResultCode !== undefined || callback?.resultCode !== undefined) {
//       console.log("🔧 Detected Format 2: Direct Properties");
//       Result = callback;
//       ResultCode = callback.ResultCode || callback.resultCode;
//       ResultDesc = callback.ResultDesc || callback.resultDesc;
//       OriginatorConversationID = callback.OriginatorConversationID || callback.originatorConversationID;
//       ConversationID = callback.ConversationID || callback.conversationID;
//       MpesaTransactionID = callback.TransactionID || callback.transactionID || callback.MpesaTransactionID;
//     }
//     // FORMAT 3: STK-like format (uncommon for B2C but possible)
//     else if (callback?.Body?.stkCallback) {
//       console.log("🔧 Detected Format 3: STK-like Format");
//       Result = callback.Body.stkCallback;
//       ResultCode = Result.ResultCode;
//       ResultDesc = Result.ResultDesc;
//       OriginatorConversationID = callback.Body.OriginatorConversationID || callback.Body.originatorConversationID;
//       ConversationID = callback.Body.ConversationID || callback.Body.conversationID;
//       MpesaTransactionID = Result.TransactionID;
//     }
//     // FORMAT 4: Nested Result object with different structure
//     else {
//       console.log("🔧 Detected Format 4: Unknown - Attempting deep search");
//       // Deep search for common fields
//       Result = callback;
//       ResultCode = findNestedValue(callback, ['ResultCode', 'resultCode', 'Result.ResultCode']);
//       ResultDesc = findNestedValue(callback, ['ResultDesc', 'resultDesc', 'Result.ResultDesc']);
//       OriginatorConversationID = findNestedValue(callback, ['OriginatorConversationID', 'originatorConversationID', 'Result.OriginatorConversationID']);
//       ConversationID = findNestedValue(callback, ['ConversationID', 'conversationID', 'Result.ConversationID']);
//       MpesaTransactionID = findNestedValue(callback, ['TransactionID', 'transactionID', 'MpesaTransactionID', 'Result.TransactionID']);
//     }

//     console.log(`🔍 Parsed B2C Callback:
//       ➤ ResultCode: ${ResultCode} (${ResultDesc})
//       ➤ ConversationID: ${ConversationID}
//       ➤ OriginatorConversationID: ${OriginatorConversationID}
//       ➤ MpesaTransactionID: ${MpesaTransactionID}
//     `);

//     // ✅ TRANSACTION MATCHING - Multiple strategies

// let transaction = await Transaction.findOne({
//   $or: [
//     { checkoutRequestID: OriginatorConversationID },
//     { conversationID: ConversationID }
//   ]
// });

// if (!transaction) {
//   return res.status(200).json({ message: "No transaction found" });
// }

// if (transaction.status === "successful") {
//   return res.status(200).json({ message: "Already processed" });
// }

// if (transaction.status === "failed") {
//   return res.status(200).json({ message: "Already failed" });
// }


//     /* =====================================================
//        3️⃣ START SESSION ONLY NOW
//     ===================================================== */

//    session = await mongoose.startSession();
// session.startTransaction();


// // STRATEGY 2: Match by OriginatorConversationID
// if (!transaction && OriginatorConversationID) {
//   transaction = await Transaction.findOne({
//     $or: [
//       { checkoutRequestID: OriginatorConversationID },
//       { conversationID: OriginatorConversationID }
//     ],
//     status: "pending"
//   }).session(session);

//   if (transaction) {
//     console.log(
//       `✅ Found transaction by OriginatorConversationID: ${OriginatorConversationID}`
//     );
//   }
// }

// // STRATEGY 3: Match by MpesaTransactionID (Receipt)
// if (!transaction && MpesaTransactionID) {
//   transaction = await Transaction.findOne({
//     mpesaTransactionID: MpesaTransactionID,
//     status: "pending"
//   }).session(session);

//   if (transaction) {
//     console.log(
//       `✅ Found transaction by MpesaTransactionID: ${MpesaTransactionID}`
//     );
//   }
// }


//     if (!transaction) {
//       console.log("❌ NO MATCHING PENDING TRANSACTION FOUND AFTER ALL ATTEMPTS");
//       console.log("🔍 What we were looking for:");
//       console.log("   - ConversationID:", ConversationID);
//       console.log("   - OriginatorConversationID:", OriginatorConversationID);
//       console.log("   - MpesaTransactionID:", MpesaTransactionID);

//       await session.commitTransaction();
//       session.endSession();
//       return res.status(200).json({ message: "No pending transaction found" });
//     }

//     console.log(`✅ Transaction Match Found: 
//       ID: ${transaction._id}
//       Type: ${transaction.type}
//       Amount: ${transaction.amount}
//       User: ${transaction.userId}
//       Phone: ${transaction.phone}
//       checkoutRequestID: ${transaction.checkoutRequestID}
//       Created: ${transaction.createdAt}
//     `);

//     // ✅ PREVENT DOUBLE PROCESSING
//     if (transaction.status !== "pending") {
//       console.log(`⚠️ Transaction already ${transaction.status} - ignoring callback`);
//       await session.commitTransaction();
//       session.endSession();
//       return res.status(200).json({ message: "Transaction already processed" });
//     }

//     // ✅ FAILED PAYMENT FLOW
//     if (ResultCode !== 0) {
//       console.log("❌ M-Pesa reported FAILURE - Reversing transaction...");

//       transaction.status = "failed";
//       transaction.mpesaPayload = Result;
//       transaction.failureReason = ResultDesc;

//       await transaction.save({ session });

//       // Handle reversal based on transaction type
//       if (transaction.type === "loan issued") {
//         console.log("🔄 Reversing loan disbursement...");
//         const loan = await Loan.findById(transaction.loanId).session(session);
//         if (loan) {
//           // Reset loan status
//           loan.status = "failed";
//           loan.loanRequestStatus = "rejected";
//           await loan.save({ session });

//           // Reset agent commission
//           if (loan.requestedByAgentId) {
//             await AgentCommission.updateOne(
//               { 
//                 agentId: loan.requestedByAgentId,
//                 loanId: loan._id,
//                 commissionType: "approval"
//               },
//               { 
//                 status: "cancelled",
//                 cancelledAt: new Date(),
//                 cancellationReason: `Loan disbursement failed: ${ResultDesc}`
//               },
//               { session }
//             );
//             console.log(`❌ Agent commission cancelled for loan ${loan._id}`);
//           }
//         }
//       }
//       else if (transaction.type === "withdrawal") {
//         console.log("🔄 Withdrawal failed - no balance to reverse");
//         const user = await User.findById(transaction.userId).session(session);
//         if (user) {
//           console.log(`⚠️ Withdrawal failed for user ${user._id} - balance was never deducted`);
//         }
//       }
//       else if (transaction.type === "customer withdrawal") {
//         console.log("🔄 Customer savings withdrawal failed - no balance to reverse");
//         const customer = await Borrower.findById(transaction.userId).session(session);
//         if (customer) {
//           console.log(`⚠️ Customer withdrawal failed for ${customer._id} - savings balance was never deducted`);
//         }
//       }
//  // 🔥 ADD AGENT WITHDRAWAL FAILURE HANDLING HERE
//   else if (transaction.type === "agent withdrawal") {
//     console.log("🔄 Agent withdrawal failed - no balance to reverse");
//     const agent = await AgentModel.findById(transaction.userId).session(session);
//     if (agent) {
//       console.log(`⚠️ Agent withdrawal failed for ${agent._id} - balance was never deducted`);

//       // Update withdrawal request status to failed
//       const withdrawalRequest = await WithdrawRequest.findOne({ 
//         transactionId: transaction._id 
//       }).session(session);

//       if (withdrawalRequest) {
//         withdrawalRequest.status = "failed";
//         withdrawalRequest.failureReason = ResultDesc;
//         await withdrawalRequest.save({ session });

//         // Send failure notification to agent
//         postCommitTasks.push(async () => {
//           await Notification.create({
//             userId: agent._id,
//             userModel: "Agent",
//             title: "Withdrawal Failed",
//             message: `Your withdrawal of KES ${transaction.amount} failed. Reason: ${ResultDesc}`,
//             type: "withdrawal_failed",
//           });

//           await sendSMS(
//             agent.phone,
//             `Dear ${agent.fullName}, your withdrawal of KES ${transaction.amount} has failed. \nReason: ${ResultDesc}. \nREF: ${transaction._id}\nPlease try again or contact support.\n- izifinance Support`
//           );
//         });
//       }
//     }
//   }

//       await session.commitTransaction();
//       session.endSession();

//       // Send failure notifications
//       postCommitTasks.push(async () => {
//         try {
//           if (transaction.type === "loan issued") {
//             const loan = await Loan.findById(transaction.loanId)
//               .populate('borrowerId')
//               .populate('lenderId');

//             if (loan && loan.borrowerId) {
//               // Get borrower name from Customer model
//               const borrower = await Borrower.findById(loan.borrowerId._id || loan.borrowerId);
//               const borrowerName = borrower?.fullName || "Customer";

//               await sendSMS(
//                 loan.borrowerId.phone,
//                 `Dear ${borrowerName}, your loan disbursement of KES ${transaction.amount} has failed. \nReason: ${ResultDesc}. \nREF: ${transaction._id}\nFor assistance, contact izifinance Support.`
//               );
//             }
//           }
//           else if (transaction.type === "withdrawal") {
//             // For User withdrawals - get name from Profile
//             const user = await User.findById(transaction.userId);
//             if (user) {
//               const profile = await Profile.findOne({ userId: user._id });
//               const userName = profile?.fullName || "Customer";

//               await sendSMS(
//                 user.phone,
//                 `Dear ${userName}, your withdrawal of KES ${transaction.amount} has failed. \nReason: ${ResultDesc}. \nREF: ${transaction._id}\nPlease try again.\n- izifinance Support`
//               );
//             }
//           }
//           else if (transaction.type === "customer withdrawal") {
//             // For Customer withdrawals - get name from Customer model
//             const customer = await Borrower.findById(transaction.userId);
//             if (customer) {
//               await sendSMS(
//                 customer.phone,
//                 `Dear ${customer.fullName}, your savings withdrawal of KES ${transaction.amount} has failed. \nReason: ${ResultDesc}. \nREF: ${transaction._id}\nPlease retry or contact support.\n- izifinance Support`
//               );
//             }
//           }
//         } catch (smsError) {
//           console.error("Failed to send failure SMS:", smsError);
//         }
//       });

//       // Execute post-commit tasks
//       try {
//         await Promise.all(postCommitTasks.map(fn => fn().catch(e => console.error("Post-commit task error:", e))));
//       } catch (asyncError) {
//         console.error("Some post-commit tasks failed:", asyncError);
//       }

//       return res.status(200).json({ message: "Transaction failed and reversed" });
//     }

//     // ✅ SUCCESS CASE HANDLING
//     console.log("🎉 SUCCESS — Updating database...");

//     transaction.status = "successful";
//     transaction.transactionId = MpesaTransactionID || ConversationID || OriginatorConversationID;
//     transaction.mpesaPayload = Result;
//     transaction.processedAt = new Date();

//     // Update checkoutRequestID if it wasn't set properly
//     if (!transaction.checkoutRequestID && (ConversationID || OriginatorConversationID)) {
//       transaction.checkoutRequestID = ConversationID || OriginatorConversationID;
//     }

//     // ✅ LOAN DISBURSEMENT HANDLING - DEDUCT LENDER BALANCE ONLY ON SUCCESS
//     if (transaction.type === "loan issued") {
//       console.log("💰 Processing loan disbursement...");

//       const loan = await Loan.findById(transaction.loanId)
//         .populate('borrowerId')
//         .populate('requestedByAgentId')
//         .populate('lenderId')
//         .session(session);

//       if (loan) {
//         console.log(`📝 Updating loan ${loan._id} to active status`);

//         // ✅ DEDUCT LENDER BALANCE ONLY WHEN M-PESA CONFIRMS SUCCESS
//         const lender = await User.findById(loan.lenderId).session(session);
//         if (lender) {
//           const balanceBefore = lender.walletBalance;
//           lender.walletBalance -= Number(transaction.amount);
//           transaction.balanceBefore = balanceBefore;
//           transaction.balanceAfter = lender.walletBalance;
//           await lender.save({ session });
//           console.log(`💸 Deducted ${transaction.amount} from lender ${lender._id}. New balance: ${lender.walletBalance}`);
//         }

//         // Update loan status to active
//         loan.status = "active";
//         loan.loanRequestStatus = "approved";
//         loan.balance = loan.totalRepayment;
//         loan.disbursedAt = new Date();

//         await loan.save({ session });

//         // Update borrower's loan balance
//         const borrower = await Borrower.findById(loan.borrowerId).session(session);
//         if (borrower) {
//           borrower.loanBalance = (borrower.loanBalance || 0) + Number(loan.amount);
//           await borrower.save({ session });
//           console.log(`👤 Updated borrower ${borrower._id} loan balance to ${borrower.loanBalance}`);
//         }

//         // Update transaction
//         await transaction.save({ session });

//         // ✅ AGENT COMMISSION FOR LOAN DISBURSEMENT
//         let commissionAmount = 0;

//         if (loan.requestedByAgentId) {
//           commissionAmount = loan.amount * 0.0495; // 4.95% commission

//           const commissionUpdate = await AgentCommission.updateOne(
//             { 
//               agentId: loan.requestedByAgentId,
//               loanId: loan._id,
//               commissionType: "approval"
//             },
//             { 
//               status: "earned",
//               amount: commissionAmount,
//               earnedAt: new Date(),
//               transactionId: transaction._id
//             },
//             { session }
//           );

//           if (commissionUpdate.modifiedCount > 0) {
//             console.log(`💰 Agent approval commission earned: KES ${commissionAmount} for loan ${loan._id}`);

//             // Update agent's wallet
//             const agent = await AgentModel.findById(loan.requestedByAgentId).session(session);
//             if (agent) {
//               agent.walletBalance += commissionAmount;
//               agent.commissionEarned += commissionAmount;
//               await agent.save({ session });
//               console.log(`💰 Commission added to agent wallet: KES ${commissionAmount}. New balance: KES ${agent.walletBalance}`);
//             }
//           }
//         }

//         postCommitTasks.push(async () => {
//           // Get borrower name from Customer model
//           const borrower = await Borrower.findById(loan.borrowerId._id || loan.borrowerId);
//           const borrowerName = borrower?.fullName || "Customer";

//           // Get lender name from Profile
//           const lenderProfile = await Profile.findOne({ userId: loan.lenderId._id || loan.lenderId });
//           const lenderName = lenderProfile?.fullName || "Lender";

//           // Notify borrower
//           await Notification.create({
//             userId: loan.borrowerId._id || loan.borrowerId,
//             userModel: "Customer",
//             title: "Loan Disbursed Successfully",
//             message: `Your loan of KES ${loan.amount} has been sent to your M-Pesa account.`,
//             type: "loan",
//           });

//           await sendSMS(
//             loan.borrowerId.phone,
//             `Dear ${borrowerName}, your loan of KES ${loan.amount} has been successfully disbursed to your M-Pesa account. \nTotal repayment: KES ${loan.totalRepayment} due on ${loan.dueDate.toLocaleDateString()}. \nREF: ${transaction._id}\nThank you for choosing izifinance.`
//           );

//           // Notify lender
//           await Notification.create({
//             userId: loan.lenderId._id || loan.lenderId,
//             userModel: "User",
//             title: "Loan Disbursed",
//             message: `Loan of KES ${loan.amount} has been successfully sent to borrower ${borrowerName}.`,
//             type: "loan",
//           });

//           // await sendSMS(
//           //   loan.lenderId.phone,
//           //   `Dear ${lenderName}, a loan of KES ${loan.amount} has been disbursed to borrower ${borrowerName}. \nTotal repayment: KES ${loan.totalRepayment} due on ${loan.dueDate.toLocaleDateString()}. \nREF: ${transaction._id}\n- izifinance`
//           // );

//           // Notify agent about commission
//           if (loan.requestedByAgentId) {
//             const agent = await AgentModel.findById(loan.requestedByAgentId);
//             const agentName = agent?.fullName || "Agent";

//             await Notification.create({
//               userId: loan.requestedByAgentId._id || loan.requestedByAgentId,
//               userModel: "Agent",
//               title: "Commission Earned",
//               message: `You earned KES ${commissionAmount} commission for loan disbursement to ${borrowerName}.`,
//               type: "commission",
//             });

//             await sendSMS(
//               loan.requestedByAgentId.phone,
//               `Dear ${agentName}, you have earned KES ${commissionAmount} commission for loan disbursement to ${borrowerName}. \nREF: ${transaction._id}\n- izifinance`
//             );
//           }
//         });
//       }
//     }
//     // ✅ USER WITHDRAWAL HANDLING - DEDUCT BALANCE ONLY ON SUCCESS
//     else if (transaction.type === "withdrawal") {
//       console.log("💰 Processing user withdrawal...");

//       // ✅ DEDUCT BALANCE ONLY WHEN M-PESA CONFIRMS SUCCESS
//       const user = await User.findById(transaction.userId).session(session);
//       if (user) {
//         const balanceBefore = user.walletBalance;
//         user.walletBalance -= Number(transaction.amount);
//         transaction.balanceBefore = balanceBefore;
//         transaction.balanceAfter = user.walletBalance;
//         await user.save({ session });
//         console.log(`💸 Deducted ${transaction.amount} from user ${user._id}. New balance: ${user.walletBalance}`);
//       }

//       await transaction.save({ session });

//       postCommitTasks.push(async () => {
//         if (user) {
//           // Get user name from Profile
//           const profile = await Profile.findOne({ userId: user._id });
//           const userName = profile?.fullName || "Customer";

//           await Notification.create({
//             userId: user._id,
//             userModel: "User",
//             title: "Withdrawal Successful",
//             message: `KES ${transaction.amount} has been withdrawn from your wallet.`,
//             type: "withdraw",
//           });

//           await sendSMS(
//             user.phone,
//             `Dear ${userName}, your withdrawal of KES ${transaction.amount} has been processed successfully. \nNew wallet balance: KES ${user.walletBalance}. \nREF: ${transaction._id}\nFunds are on the way to your M-Pesa.\n- izifinance`
//           );
//         }
//       });
//     }
//     // ✅ CUSTOMER SAVINGS WITHDRAWAL HANDLING - DEDUCT BALANCE ONLY ON SUCCESS
//     else if (transaction.type === "customer withdrawal") {
//       console.log("💰 Processing customer savings withdrawal...");

//       // For customer withdrawals, deduct from savings balance ONLY ON SUCCESS
//       const customer = await Borrower.findById(transaction.userId).session(session);
//       if (customer) {
//         const balanceBefore = customer.savingsBalance;
//         customer.savingsBalance -= Number(transaction.amount);
//         transaction.balanceBefore = balanceBefore;
//         transaction.balanceAfter = customer.savingsBalance;
//         await customer.save({ session });
//         console.log(`👤 Updated customer ${customer._id} savings balance to ${customer.savingsBalance}`);
//       }

//       await transaction.save({ session });

//       postCommitTasks.push(async () => {
//         if (customer) {
//           await Notification.create({
//             userId: customer._id,
//             userModel: "Customer",
//             title: "Savings Withdrawal Successful",
//             message: `You have withdrawn KES ${transaction.amount} from your savings.`,
//             type: "withdraw",
//           });

//           await sendSMS(
//             customer.phone,
//             `Dear ${customer.fullName}, your savings withdrawal of KES ${transaction.amount} has been processed successfully. \nNew savings balance: KES ${customer.savingsBalance}. \nREF: ${transaction._id}\nFunds have been sent to your M-Pesa.\n- izifinance`
//           );
//         }
//       });
//     }
// // 🔥 ADD AGENT WITHDRAWAL HANDLING RIGHT HERE
// else if (transaction.type === "agent withdrawal") {
//   // PASTE YOUR AGENT WITHDRAWAL CODE HERE
//   console.log("💰 Processing agent withdrawal...");

//   // ✅ DEDUCT AGENT BALANCE ONLY WHEN M-PESA CONFIRMS SUCCESS
//   const agent = await AgentModel.findById(transaction.userId).session(session);
//   if (agent) {
//     const balanceBefore = agent.walletBalance;
//     agent.walletBalance -= Number(transaction.amount);
//     transaction.balanceBefore = balanceBefore;
//     transaction.balanceAfter = agent.walletBalance;
//     await agent.save({ session });
//     console.log(`💸 Deducted ${transaction.amount} from agent ${agent._id}. New balance: ${agent.walletBalance}`);
//   }

//   // Update withdrawal request status
//   const withdrawalRequest = await WithdrawRequest.findOne({ 
//     transactionId: transaction._id 
//   }).populate('lenderId').session(session);

//   if (withdrawalRequest) {
//     withdrawalRequest.status = "completed";
//     withdrawalRequest.processedAt = new Date();
//     await withdrawalRequest.save({ session });
//     console.log(`✅ Updated withdrawal request ${withdrawalRequest._id} to completed`);
//   }

//   await transaction.save({ session });

//   postCommitTasks.push(async () => {
//     if (agent) {
//       // Get lender details for notification
//       const lender = withdrawalRequest?.lenderId;
//       const lenderProfile = lender ? await Profile.findOne({ userId: lender._id }) : null;
//       const lenderName = lenderProfile?.fullName || "Lender";

//       // 🔔 NOTIFY AGENT
//       await Notification.create({
//         userId: agent._id,
//         userModel: "Agent",
//         title: "Withdrawal Successful",
//         message: `Your withdrawal of KES ${transaction.amount} has been processed successfully.`,
//         type: "withdraw",
//       });

//  await sendSMS(
//   agent.phone,
//   `Dear ${agent.name}, your withdrawal of KES ${transaction.amount} has been processed successfully.
// New wallet balance: KES ${agent.walletBalance}.
// REF: ${transaction._id}
// Funds are on the way to your M-Pesa.
// - izifinance`
// );


//       // 🔔 NOTIFY LENDER (if exists)
//       if (lender) {
//         await Notification.create({
//           userId: lender._id,
//           userModel: "User",
//           title: "Agent Withdrawal Processed",
//           message: `Agent ${agent.name} has successfully withdrawn KES ${transaction.amount}.`,
//           type: "agent_withdrawal",
//         });

//         // await sendSMS(
//         //   lender.phone,
//         //   `Dear ${lenderName}, agent ${agent.name} has successfully withdrawn KES ${transaction.amount}. \nTransaction reference: ${transaction._id}\n- izifinance`
//         // );
//       }
//     }
//   });
// }

//     // ✅ COMMIT TRANSACTION
//     await session.commitTransaction();
//     session.endSession();

//     console.log("🚀 Executing post-commit tasks...");

//     // ✅ EXECUTE ASYNC TASKS
//     try {
//       await Promise.all(postCommitTasks.map(fn => fn().catch(e => console.error("Post-commit task error:", e))));
//       console.log("✅ All post-commit tasks completed");
//     } catch (asyncError) {
//       console.error("Some post-commit tasks failed:", asyncError);
//     }

//     return res.status(200).json({ 
//       message: "B2C callback processed successfully",
//       transactionId: transaction._id 
//     });

// } catch (err) {
//   console.error("🔥 B2C CALLBACK ERROR:", err);

//   if (session) {
//     try {
//       if (session.inTransaction()) {
//         await session.abortTransaction();
//       }
//     } catch (abortError) {
//       console.error("Error aborting transaction:", abortError);
//     } finally {
//       session.endSession();
//     }
//   }

//   return res.status(500).json({
//     error: "Internal server error processing callback",
//     details: err.message,
//   });
// }
// }

// exports.b2cCallback = async (req, res) => {
//   console.log("\n📥 B2C CALLBACK RECEIVED");
//   console.log("==============================\n");

// let session;

//   const postCommitTasks = [];

//   try {
//     const callback = req.body;
//     console.log("📩 Raw Callback Body:", JSON.stringify(callback, null, 2));

//     // ✅ IMPROVED CALLBACK PARSING - Handle ALL M-Pesa B2C formats
//     let Result, ResultCode, ResultDesc, OriginatorConversationID, ConversationID, MpesaTransactionID;

//     // FORMAT 1: Standard M-Pesa B2C Callback Format
//     if (callback?.Result) {
//       console.log("🔧 Detected Format 1: Standard B2C Callback");
//       Result = callback.Result;
//       ResultCode = Result.ResultCode;
//       ResultDesc = Result.ResultDesc;
//       OriginatorConversationID = Result.OriginatorConversationID;
//       ConversationID = Result.ConversationID;

//       // Extract TransactionID from ResultParameters if available
//       if (Result.ResultParameters && Result.ResultParameters.ResultParameter) {
//         const resultParams = Result.ResultParameters.ResultParameter;
//         if (Array.isArray(resultParams)) {
//           const transactionParam = resultParams.find(param => 
//             param.Key === "TransactionID" || param.Key === "TransactionReceipt"
//           );
//           if (transactionParam) {
//             MpesaTransactionID = transactionParam.Value;
//           }
//         }
//       }

//       // Fallback to direct TransactionID
//       if (!MpesaTransactionID) {
//         MpesaTransactionID = Result.TransactionID;
//       }
//     }
//     // FORMAT 2: Direct properties (Manual testing format)
//     else if (callback?.ResultCode !== undefined || callback?.resultCode !== undefined) {
//       console.log("🔧 Detected Format 2: Direct Properties");
//       Result = callback;
//       ResultCode = callback.ResultCode || callback.resultCode;
//       ResultDesc = callback.ResultDesc || callback.resultDesc;
//       OriginatorConversationID = callback.OriginatorConversationID || callback.originatorConversationID;
//       ConversationID = callback.ConversationID || callback.conversationID;
//       MpesaTransactionID = callback.TransactionID || callback.transactionID || callback.MpesaTransactionID;
//     }
//     // FORMAT 3: STK-like format (uncommon for B2C but possible)
//     else if (callback?.Body?.stkCallback) {
//       console.log("🔧 Detected Format 3: STK-like Format");
//       Result = callback.Body.stkCallback;
//       ResultCode = Result.ResultCode;
//       ResultDesc = Result.ResultDesc;
//       OriginatorConversationID = callback.Body.OriginatorConversationID || callback.Body.originatorConversationID;
//       ConversationID = callback.Body.ConversationID || callback.Body.conversationID;
//       MpesaTransactionID = Result.TransactionID;
//     }
//     // FORMAT 4: Nested Result object with different structure
//     else {
//       console.log("🔧 Detected Format 4: Unknown - Attempting deep search");
//       // Deep search for common fields
//       Result = callback;
//       ResultCode = findNestedValue(callback, ['ResultCode', 'resultCode', 'Result.ResultCode']);
//       ResultDesc = findNestedValue(callback, ['ResultDesc', 'resultDesc', 'Result.ResultDesc']);
//       OriginatorConversationID = findNestedValue(callback, ['OriginatorConversationID', 'originatorConversationID', 'Result.OriginatorConversationID']);
//       ConversationID = findNestedValue(callback, ['ConversationID', 'conversationID', 'Result.ConversationID']);
//       MpesaTransactionID = findNestedValue(callback, ['TransactionID', 'transactionID', 'MpesaTransactionID', 'Result.TransactionID']);
//     }

//     console.log(`🔍 Parsed B2C Callback:
//       ➤ ResultCode: ${ResultCode} (${ResultDesc})
//       ➤ ConversationID: ${ConversationID}
//       ➤ OriginatorConversationID: ${OriginatorConversationID}
//       ➤ MpesaTransactionID: ${MpesaTransactionID}
//     `);

//     // ✅ TRANSACTION MATCHING - Multiple strategies

// let transaction = await Transaction.findOne({
//   $or: [
//     { checkoutRequestID: OriginatorConversationID },
//     { conversationID: ConversationID }
//   ]
// });

// if (!transaction) {
//   return res.status(200).json({ message: "No transaction found" });
// }

// if (transaction.status === "successful") {
//   return res.status(200).json({ message: "Already processed" });
// }

// if (transaction.status === "failed") {
//   return res.status(200).json({ message: "Already failed" });
// }


//     /* =====================================================
//        3️⃣ START SESSION ONLY NOW
//     ===================================================== */

//    session = await mongoose.startSession();
//    session.startTransaction();


// // STRATEGY 2: Match by OriginatorConversationID
// if (!transaction && OriginatorConversationID) {
//   transaction = await Transaction.findOne({
//     $or: [
//       { checkoutRequestID: OriginatorConversationID },
//       { conversationID: OriginatorConversationID }
//     ],
//     status: "pending"
//   }).session(session);

//   if (transaction) {
//     console.log(
//       `✅ Found transaction by OriginatorConversationID: ${OriginatorConversationID}`
//     );
//   }
// }

// // STRATEGY 3: Match by MpesaTransactionID (Receipt)
// if (!transaction && MpesaTransactionID) {
//   transaction = await Transaction.findOne({
//     mpesaTransactionID: MpesaTransactionID,
//     status: "pending"
//   }).session(session);

//   if (transaction) {
//     console.log(
//       `✅ Found transaction by MpesaTransactionID: ${MpesaTransactionID}`
//     );
//   }
// }


//     if (!transaction) {
//       console.log("❌ NO MATCHING PENDING TRANSACTION FOUND AFTER ALL ATTEMPTS");
//       console.log("🔍 What we were looking for:");
//       console.log("   - ConversationID:", ConversationID);
//       console.log("   - OriginatorConversationID:", OriginatorConversationID);
//       console.log("   - MpesaTransactionID:", MpesaTransactionID);

//       await session.commitTransaction();
//       session.endSession();
//       return res.status(200).json({ message: "No pending transaction found" });
//     }

//     console.log(`✅ Transaction Match Found: 
//       ID: ${transaction._id}
//       Type: ${transaction.type}
//       Amount: ${transaction.amount}
//       User: ${transaction.userId}
//       Phone: ${transaction.phone}
//       checkoutRequestID: ${transaction.checkoutRequestID}
//       Created: ${transaction.createdAt}
//     `);

//     // ✅ PREVENT DOUBLE PROCESSING
//     if (transaction.status !== "pending") {
//       console.log(`⚠️ Transaction already ${transaction.status} - ignoring callback`);
//       await session.commitTransaction();
//       session.endSession();
//       return res.status(200).json({ message: "Transaction already processed" });
//     }

//     // ✅ FAILED PAYMENT FLOW
//     if (ResultCode !== 0) {
//       console.log("❌ M-Pesa reported FAILURE - Reversing transaction...");

//       transaction.status = "failed";
//       transaction.mpesaPayload = Result;
//       transaction.failureReason = ResultDesc;
//       transaction.charge = fee;
//       transaction.totalDebit = totalDebit;


//       await transaction.save({ session });

//       // Handle reversal based on transaction type
//       if (transaction.type === "loan issued") {
//         console.log("🔄 Reversing loan disbursement...");
//         const loan = await Loan.findById(transaction.loanId).session(session);
//         if (loan) {
//           // Reset loan status
//           loan.status = "failed";
//           loan.loanRequestStatus = "rejected";
//           await loan.save({ session });

//           // Reset agent commission
//           if (loan.requestedByAgentId) {
//             await AgentCommission.updateOne(
//               { 
//                 agentId: loan.requestedByAgentId,
//                 loanId: loan._id,
//                 commissionType: "approval"
//               },
//               { 
//                 status: "cancelled",
//                 cancelledAt: new Date(),
//                 cancellationReason: `Loan disbursement failed: ${ResultDesc}`
//               },
//               { session }
//             );
//             console.log(`❌ Agent commission cancelled for loan ${loan._id}`);
//           }
//         }
//       }
//       else if (transaction.type === "withdrawal") {
//         console.log("🔄 Withdrawal failed - no balance to reverse");
//         const user = await User.findById(transaction.userId).session(session);
//         if (user) {
//           console.log(`⚠️ Withdrawal failed for user ${user._id} - balance was never deducted`);
//         }
//       }
//       else if (transaction.type === "customer withdrawal") {
//         console.log("🔄 Customer savings withdrawal failed - no balance to reverse");
//         const customer = await Borrower.findById(transaction.userId).session(session);
//         if (customer) {
//           console.log(`⚠️ Customer withdrawal failed for ${customer._id} - savings balance was never deducted`);
//         }
//       }
//  // 🔥 ADD AGENT WITHDRAWAL FAILURE HANDLING HERE
//   else if (transaction.type === "agent withdrawal") {
//     console.log("🔄 Agent withdrawal failed - no balance to reverse");
//     const agent = await AgentModel.findById(transaction.userId).session(session);
//     if (agent) {
//       console.log(`⚠️ Agent withdrawal failed for ${agent._id} - balance was never deducted`);

//       // Update withdrawal request status to failed
//       const withdrawalRequest = await WithdrawRequest.findOne({ 
//         transactionId: transaction._id 
//       }).session(session);

//       if (withdrawalRequest) {
//         withdrawalRequest.status = "failed";
//         withdrawalRequest.failureReason = ResultDesc;
//         await withdrawalRequest.save({ session });

//         // Send failure notification to agent
//         postCommitTasks.push(async () => {
//           await Notification.create({
//             userId: agent._id,
//             userModel: "Agent",
//             title: "Withdrawal Failed",
//             message: `Your withdrawal of KES ${transaction.amount} failed. Reason: ${ResultDesc}`,
//             type: "withdrawal_failed",
//           });

//           await sendSMS(
//             agent.phone,
//             `Dear ${agent.fullName}, your withdrawal of KES ${transaction.amount} has failed. \nReason: ${ResultDesc}. \nREF: ${transaction._id}\nPlease try again or contact support.\n- izifinance Support`
//           );
//         });
//       }
//     }
//   }

//       await session.commitTransaction();
//       session.endSession();

//       // Send failure notifications
//       postCommitTasks.push(async () => {
//         try {
//           if (transaction.type === "loan issued") {
//             const loan = await Loan.findById(transaction.loanId)
//               .populate('borrowerId')
//               .populate('lenderId');

//             if (loan && loan.borrowerId) {
//               // Get borrower name from Customer model
//               const borrower = await Borrower.findById(loan.borrowerId._id || loan.borrowerId);
//               const borrowerName = borrower?.fullName || "Customer";

//               await sendSMS(
//                 loan.borrowerId.phone,
//                 `Dear ${borrowerName}, your loan disbursement of KES ${transaction.amount} has failed. \nReason: ${ResultDesc}. \nREF: ${transaction._id}\nFor assistance, contact izifinance Support.`
//               );
//             }
//           }
//           else if (transaction.type === "withdrawal") {
//             // For User withdrawals - get name from Profile
//             const user = await User.findById(transaction.userId);
//             if (user) {
//               const profile = await Profile.findOne({ userId: user._id });
//               const userName = profile?.fullName || "Customer";

//               await sendSMS(
//                 user.phone,
//                 `Dear ${userName}, your withdrawal of KES ${transaction.amount} has failed. \nReason: ${ResultDesc}. \nREF: ${transaction._id}\nPlease try again.\n- izifinance Support`
//               );
//             }
//           }
//           else if (transaction.type === "customer withdrawal") {
//             // For Customer withdrawals - get name from Customer model
//             const customer = await Borrower.findById(transaction.userId);
//             if (customer) {
//               await sendSMS(
//                 customer.phone,
//                 `Dear ${customer.fullName}, your savings withdrawal of KES ${transaction.amount} has failed. \nReason: ${ResultDesc}. \nREF: ${transaction._id}\nPlease retry or contact support.\n- izifinance Support`
//               );
//             }
//           }
//         } catch (smsError) {
//           console.error("Failed to send failure SMS:", smsError);
//         }
//       });

//       // Execute post-commit tasks
//       try {
//         await Promise.all(postCommitTasks.map(fn => fn().catch(e => console.error("Post-commit task error:", e))));
//       } catch (asyncError) {
//         console.error("Some post-commit tasks failed:", asyncError);
//       }

//       return res.status(200).json({ message: "Transaction failed and reversed" });
//     }

//     // ✅ SUCCESS CASE HANDLING
//     console.log("🎉 SUCCESS — Updating database...");

//     transaction.status = "successful";
//     transaction.transactionId = MpesaTransactionID || ConversationID || OriginatorConversationID;
//     transaction.mpesaPayload = Result;
//     transaction.processedAt = new Date();

//     // Update checkoutRequestID if it wasn't set properly
//     if (!transaction.checkoutRequestID && (ConversationID || OriginatorConversationID)) {
//       transaction.checkoutRequestID = ConversationID || OriginatorConversationID;
//     }

//     // ✅ LOAN DISBURSEMENT HANDLING - DEDUCT LENDER BALANCE ONLY ON SUCCESS
//     if (transaction.type === "loan issued") {
//       console.log("💰 Processing loan disbursement...");

//       const loan = await Loan.findById(transaction.loanId)
//         .populate('borrowerId')
//         .populate('requestedByAgentId')
//         .populate('lenderId')
//         .session(session);

//       if (loan) {
//         console.log(`📝 Updating loan ${loan._id} to active status`);

//         // ✅ DEDUCT LENDER BALANCE ONLY WHEN M-PESA CONFIRMS SUCCESS
//         const lender = await User.findById(loan.lenderId).session(session);
//         if (lender) {
//           const balanceBefore = lender.walletBalance;
//           lender.walletBalance -= Number(transaction.amount);
//           transaction.balanceBefore = balanceBefore;
//           transaction.balanceAfter = lender.walletBalance;
//           await lender.save({ session });
//           console.log(`💸 Deducted ${transaction.amount} from lender ${lender._id}. New balance: ${lender.walletBalance}`);
//         }

//         // Update loan status to active
//         loan.status = "active";
//         loan.loanRequestStatus = "approved";
//         loan.balance = loan.totalRepayment;
//         loan.disbursedAt = new Date();

//         await loan.save({ session });

//         // Update borrower's loan balance
//         const borrower = await Borrower.findById(loan.borrowerId).session(session);
//         if (borrower) {
//           borrower.loanBalance = (borrower.loanBalance || 0) + Number(loan.amount);
//           await borrower.save({ session });
//           console.log(`👤 Updated borrower ${borrower._id} loan balance to ${borrower.loanBalance}`);
//         }

//         // Update transaction
//         await transaction.save({ session });

//         // ✅ AGENT COMMISSION FOR LOAN DISBURSEMENT
//         let commissionAmount = 0;

//         if (loan.requestedByAgentId) {
//           commissionAmount = loan.amount * 0.0495; // 4.95% commission

//           const commissionUpdate = await AgentCommission.updateOne(
//             { 
//               agentId: loan.requestedByAgentId,
//               loanId: loan._id,
//               commissionType: "approval"
//             },
//             { 
//               status: "earned",
//               amount: commissionAmount,
//               earnedAt: new Date(),
//               transactionId: transaction._id
//             },
//             { session }
//           );

//           if (commissionUpdate.modifiedCount > 0) {
//             console.log(`💰 Agent approval commission earned: KES ${commissionAmount} for loan ${loan._id}`);

//             // Update agent's wallet
//             const agent = await AgentModel.findById(loan.requestedByAgentId).session(session);
//             if (agent) {
//               agent.walletBalance += commissionAmount;
//               agent.commissionEarned += commissionAmount;
//               await agent.save({ session });
//               console.log(`💰 Commission added to agent wallet: KES ${commissionAmount}. New balance: KES ${agent.walletBalance}`);
//             }
//           }
//         }

//         postCommitTasks.push(async () => {
//           // Get borrower name from Customer model
//           const borrower = await Borrower.findById(loan.borrowerId._id || loan.borrowerId);
//           const borrowerName = borrower?.fullName || "Customer";

//           // Get lender name from Profile
//           const lenderProfile = await Profile.findOne({ userId: loan.lenderId._id || loan.lenderId });
//           const lenderName = lenderProfile?.fullName || "Lender";

//           // Notify borrower
//           await Notification.create({
//             userId: loan.borrowerId._id || loan.borrowerId,
//             userModel: "Customer",
//             title: "Loan Disbursed Successfully",
//             message: `Your loan of KES ${loan.amount} has been sent to your M-Pesa account.`,
//             type: "loan",
//           });

//           await sendSMS(
//             loan.borrowerId.phone,
//             `Dear ${borrowerName}, your loan of KES ${loan.amount} has been successfully disbursed to your M-Pesa account. \nTotal repayment: KES ${loan.totalRepayment} due on ${loan.dueDate.toLocaleDateString()}. \nREF: ${transaction._id}\nThank you for choosing izifinance.`
//           );

//           // Notify lender
//           await Notification.create({
//             userId: loan.lenderId._id || loan.lenderId,
//             userModel: "User",
//             title: "Loan Disbursed",
//             message: `Loan of KES ${loan.amount} has been successfully sent to borrower ${borrowerName}.`,
//             type: "loan",
//           });

//           // await sendSMS(
//           //   loan.lenderId.phone,
//           //   `Dear ${lenderName}, a loan of KES ${loan.amount} has been disbursed to borrower ${borrowerName}. \nTotal repayment: KES ${loan.totalRepayment} due on ${loan.dueDate.toLocaleDateString()}. \nREF: ${transaction._id}\n- izifinance`
//           // );

//           // Notify agent about commission
//           if (loan.requestedByAgentId) {
//             const agent = await AgentModel.findById(loan.requestedByAgentId);
//             const agentName = agent?.fullName || "Agent";

//             await Notification.create({
//               userId: loan.requestedByAgentId._id || loan.requestedByAgentId,
//               userModel: "Agent",
//               title: "Commission Earned",
//               message: `You earned KES ${commissionAmount} commission for loan disbursement to ${borrowerName}.`,
//               type: "commission",
//             });

//             await sendSMS(
//               loan.requestedByAgentId.phone,
//               `Dear ${agentName}, you have earned KES ${commissionAmount} commission for loan disbursement to ${borrowerName}. \nREF: ${transaction._id}\n- izifinance`
//             );
//           }
//         });
//       }
//     }
//     // ✅ USER WITHDRAWAL HANDLING - DEDUCT BALANCE ONLY ON SUCCESS
//     else if (transaction.type === "withdrawal") {
//       console.log("💰 Processing user withdrawal...");

//       // ✅ DEDUCT BALANCE ONLY WHEN M-PESA CONFIRMS SUCCESS
//       const user = await User.findById(transaction.userId).session(session);
//       if (user) {
//         const balanceBefore = user.walletBalance;
//         user.walletBalance -= Number(transaction.amount);
//         transaction.balanceBefore = balanceBefore;
//         transaction.balanceAfter = user.walletBalance;
//         await user.save({ session });
//         console.log(`💸 Deducted ${transaction.amount} from user ${user._id}. New balance: ${user.walletBalance}`);
//       }

//       await transaction.save({ session });

//       postCommitTasks.push(async () => {
//         if (user) {
//           // Get user name from Profile
//           const profile = await Profile.findOne({ userId: user._id });
//           const userName = profile?.fullName || "Customer";

//           await Notification.create({
//             userId: user._id,
//             userModel: "User",
//             title: "Withdrawal Successful",
//             message: `KES ${transaction.amount} has been withdrawn from your wallet.`,
//             type: "withdraw",
//           });

//           await sendSMS(
//             user.phone,
//             `Dear ${userName}, your withdrawal of KES ${transaction.amount} has been processed successfully. \nNew wallet balance: KES ${user.walletBalance}. \nREF: ${transaction._id}\nFunds are on the way to your M-Pesa.\n- izifinance`
//           );
//         }
//       });
//     }
//     // ✅ CUSTOMER SAVINGS WITHDRAWAL HANDLING - DEDUCT BALANCE ONLY ON SUCCESS
//     else if (transaction.type === "customer withdrawal") {
//   console.log("💰 Processing customer savings withdrawal with dynamic B2C charge...");

//   const customer = await Borrower.findById(transaction.userId).session(session);

//   if (customer) {

//     const balanceBefore = Number(customer.savingsBalance || 0);

//     const withdrawalAmount = Number(transaction.amount);

//     // 🔥 Calculate fee using your method
//     const fee = getB2CCharge(withdrawalAmount);

//     const totalDebit = withdrawalAmount + fee;

//     if (balanceBefore < totalDebit) {
//       throw new Error("Insufficient savings balance");
//     }

//     const balanceAfter = balanceBefore - totalDebit;

//     customer.savingsBalance = balanceAfter;

//     transaction.charge = fee; // store calculated fee
//     transaction.balanceBefore = balanceBefore;
//     transaction.balanceAfter = balanceAfter;

//     await customer.save({ session });

//     console.log(`👤 Savings updated: ${balanceBefore} → ${balanceAfter} (Fee: ${fee})`);
//   }

//   await transaction.save({ session });

//   postCommitTasks.push(async () => {
//     if (!customer) return;

//     // 🔔 CUSTOMER NOTIFICATION
//     // await Notification.create({
//     //   userId: customer._id,
//     //   userModel: "Customer",
//     //   title: "Savings Withdrawal Successful",
//     //   message: `KES ${transaction.amount} withdrawn. Fee: KES ${transaction.charge}. Balance: KES ${customer.savingsBalance}`,
//     //   type: "withdraw",
//     // });

//     // 📩 CUSTOMER SMS
//     await sendSMS(
//       customer.phone,
//       `Dear ${customer.fullName}, your savings withdrawal of KES ${transaction.amount} has been processed successfully.
// B2C charge: KES ${transaction.charge}.
// New savings balance: KES ${customer.savingsBalance}.
// REF: ${transaction._id}
// Funds have been sent to your M-Pesa.
// - izifinance`
//     );

//     // 🔔 LENDER NOTIFICATION (if exists)
//     if (transaction.lenderId) {
//       await Notification.create({
//         userId: transaction.lenderId,
//         userModel: "User",
//         title: "Customer Withdrawal Processed",
//         message: `Customer ${customer.fullName} withdrew KES ${transaction.amount}.`,
//         type: "customer_withdrawal",
//       });
//     }
//   });
// }

// // 🔥 ADD AGENT WITHDRAWAL HANDLING RIGHT HERE
// else if (transaction.type === "agent withdrawal") {
//   // PASTE YOUR AGENT WITHDRAWAL CODE HERE
//   console.log("💰 Processing agent withdrawal...");

//   // ✅ DEDUCT AGENT BALANCE ONLY WHEN M-PESA CONFIRMS SUCCESS
//   const agent = await AgentModel.findById(transaction.userId).session(session);
//   if (agent) {
//     const balanceBefore = agent.walletBalance;
//     agent.walletBalance -= Number(transaction.amount);
//     transaction.balanceBefore = balanceBefore;
//     transaction.balanceAfter = agent.walletBalance;
//     await agent.save({ session });
//     console.log(`💸 Deducted ${transaction.amount} from agent ${agent._id}. New balance: ${agent.walletBalance}`);
//   }

//   // Update withdrawal request status
//   const withdrawalRequest = await WithdrawRequest.findOne({ 
//     transactionId: transaction._id 
//   }).populate('lenderId').session(session);

//   if (withdrawalRequest) {
//     withdrawalRequest.status = "completed";
//     withdrawalRequest.processedAt = new Date();
//     await withdrawalRequest.save({ session });
//     console.log(`✅ Updated withdrawal request ${withdrawalRequest._id} to completed`);
//   }

//   await transaction.save({ session });

//   postCommitTasks.push(async () => {
//     if (agent) {
//       // Get lender details for notification
//       const lender = withdrawalRequest?.lenderId;
//       const lenderProfile = lender ? await Profile.findOne({ userId: lender._id }) : null;
//       const lenderName = lenderProfile?.fullName || "Lender";

//       // 🔔 NOTIFY AGENT
//       await Notification.create({
//         userId: agent._id,
//         userModel: "Agent",
//         title: "Withdrawal Successful",
//         message: `Your withdrawal of KES ${transaction.amount} has been processed successfully.`,
//         type: "withdraw",
//       });

//  await sendSMS(
//   agent.phone,
//   `Dear ${agent.name}, your withdrawal of KES ${transaction.amount} has been processed successfully.
// New wallet balance: KES ${agent.walletBalance}.
// REF: ${transaction._id}
// Funds are on the way to your M-Pesa.
// - izifinance`
// );


//       // 🔔 NOTIFY LENDER (if exists)
//       if (lender) {
//         await Notification.create({
//           userId: lender._id,
//           userModel: "User",
//           title: "Agent Withdrawal Processed",
//           message: `Agent ${agent.name} has successfully withdrawn KES ${transaction.amount}.`,
//           type: "agent_withdrawal",
//         });

//         // await sendSMS(
//         //   lender.phone,
//         //   `Dear ${lenderName}, agent ${agent.name} has successfully withdrawn KES ${transaction.amount}. \nTransaction reference: ${transaction._id}\n- izifinance`
//         // );
//       }
//     }
//   });
// }

//     // ✅ COMMIT TRANSACTION
//     await session.commitTransaction();
//     session.endSession();

//     console.log("🚀 Executing post-commit tasks...");

//     // ✅ EXECUTE ASYNC TASKS
//     try {
//       await Promise.all(postCommitTasks.map(fn => fn().catch(e => console.error("Post-commit task error:", e))));
//       console.log("✅ All post-commit tasks completed");
//     } catch (asyncError) {
//       console.error("Some post-commit tasks failed:", asyncError);
//     }

//     return res.status(200).json({ 
//       message: "B2C callback processed successfully",
//       transactionId: transaction._id 
//     });

// } catch (err) {
//   console.error("🔥 B2C CALLBACK ERROR:", err);

//   if (session) {
//     try {
//       if (session.inTransaction()) {
//         await session.abortTransaction();
//       }
//     } catch (abortError) {
//       console.error("Error aborting transaction:", abortError);
//     } finally {
//       session.endSession();
//     }
//   }

//   return res.status(500).json({
//     error: "Internal server error processing callback",
//     details: err.message,
//   });
// }
// }









