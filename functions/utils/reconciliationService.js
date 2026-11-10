const Transaction = require("../models/Transaction");
const { querySTK } = require("./mpesa");
const { processRepayment } = require("./repaymentService");

/**
 * Periodically reconciles pending M-Pesa transactions by querying Safaricom STK Push status.
 */
const runReconciliation = async () => {
  console.log("[RECONCILIATION] Starting M-Pesa reconciliation scan...");
  try {
    // 3. Query all pending/processing/reconciliation required repayment transactions
    const transactionsToReconcile = await Transaction.find({
      type: "repayment",
      status: { $in: ["Pending", "pending", "Processing", "Reconciliation Required"] },
      reconciliationAttempts: { $lt: 5 },
    });

    console.log(`[RECONCILIATION] 🔍 Found ${transactionsToReconcile.length} pending repayments to verify.`);

    let recoveredCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const transaction of transactionsToReconcile) {
      transaction.reconciliationAttempts += 1;
      
      if (!transaction.checkoutRequestID) {
        console.warn(`[RECONCILIATION] ⚠️ Missing checkoutRequestID for transaction ID: ${transaction._id}`);
        transaction.status = "Reconciliation Required";
        transaction.reconciliationError = "Missing checkoutRequestID";
        transaction.reconciliationLog.push({
          attempt: transaction.reconciliationAttempts,
          status: "Reconciliation Required",
          message: "Transaction is missing checkoutRequestID.",
        });
        await transaction.save();
        skippedCount++;
        continue;
      }

      console.log(`[RECONCILIATION] Checking M-Pesa status for STK ID: ${transaction.checkoutRequestID} (Attempt ${transaction.reconciliationAttempts})`);

      try {
        const response = await querySTK(transaction.checkoutRequestID);
        const resultCode = response?.ResultCode !== undefined ? Number(response.ResultCode) : null;

        if (resultCode === 0) {
          // Transaction was successful on M-Pesa! Reconcile it.
          console.log(`[RECONCILIATION] 💰 Payment found on M-Pesa for STK ID: ${transaction.checkoutRequestID}. Reconciling...`);
          
          transaction.status = "Processing";
          await transaction.save();

          const mpesaReceipt = response.MpesaReceiptNumber || `REC-${transaction.checkoutRequestID}`;
          
          // Trigger all business logic normally executed by the webhook
          await processRepayment(transaction, transaction.amount, mpesaReceipt);

          transaction.status = "Paid";
          transaction.reconciliationLog.push({
            attempt: transaction.reconciliationAttempts,
            status: "Paid",
            message: `Successfully recovered payment via reconciliation. M-Pesa Receipt: ${mpesaReceipt}`,
          });
          await transaction.save();
          recoveredCount++;
          console.log(`[RECONCILIATION] ✅ Reconciled transaction ID: ${transaction._id}`);
        } else {
          // Transaction failed on M-Pesa (ResultCode non-zero, e.g. cancelled by user)
          console.log(`[RECONCILIATION] ❌ M-Pesa transaction was failed/cancelled. Code: ${resultCode}. Desc: ${response?.ResultDesc}`);
          
          transaction.status = "failed";
          transaction.reconciliationLog.push({
            attempt: transaction.reconciliationAttempts,
            status: "failed",
            message: `M-Pesa reported failure. Code: ${resultCode}. Desc: ${response?.ResultDesc}`,
          });
          await transaction.save();
          failedCount++;
        }
      } catch (err) {
        // API query failed (e.g. network timeout, Safaricom downtime, or still waiting for PIN entry)
        const errResponse = err.response?.data;
        const errCode = errResponse?.requestId || errResponse?.errorCode || errResponse?.ResultCode;
        const errMessage = errResponse?.errorMessage || errResponse?.ResultDesc || err.message;
        
        console.error(`[RECONCILIATION] ❌ Status check failed for STK ID ${transaction.checkoutRequestID}:`, errMessage);

        // If Safaricom returns a definitive failure code indicating transaction expired or not found
        // 1032 = Cancelled, 1037 = Timeout, 2001 = Invalid Initiator info (definitive fail)
        const isDefinitiveFailure = errCode && [1032, 1037, 2001, 1019].includes(Number(errCode));

        if (isDefinitiveFailure) {
          transaction.status = "failed";
          transaction.reconciliationLog.push({
            attempt: transaction.reconciliationAttempts,
            status: "failed",
            message: `M-Pesa query returned definitive failure: ${errMessage}`,
          });
          failedCount++;
        } else {
          // Transient error: retry on next cycle. If reached max attempts, flag as Reconciliation Required.
          if (transaction.reconciliationAttempts >= 5) {
            transaction.status = "Reconciliation Required";
            transaction.reconciliationError = errMessage;
            console.warn(`[RECONCILIATION] ⚠️ Max attempts reached. Flagging transaction ${transaction._id} as Reconciliation Required.`);
          } else {
            // Keep status as Pending or Processing so it is retried
            transaction.status = "Pending";
          }

          transaction.reconciliationLog.push({
            attempt: transaction.reconciliationAttempts,
            status: transaction.status,
            message: `Transient status check failure: ${errMessage}`,
          });
          skippedCount++;
        }
        await transaction.save();
      }
    }

    console.log(`[RECONCILIATION] Scan finished. Recovered: ${recoveredCount}, Failed: ${failedCount}, Skipped/Pending: ${skippedCount}`);
    
    return {
      processed: transactionsToReconcile.length,
      recoveredCount,
      failedCount,
      skippedCount,
    };
  } catch (error) {
    console.error("[RECONCILIATION] ❌ Error in runReconciliation:", error.message);
    throw error;
  }
};

module.exports = {
  runReconciliation,
};
