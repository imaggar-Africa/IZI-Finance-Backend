const User = require("../models/User");
const Loan = require("../models/Loan");
const Customer = require("../models/customer");
const Notification = require("../models/Notification");
const { sendSMS } = require("./sms");
const AgentCommission = require("../models/AgentCommission");
const AgentModel = require("../models/AgentModel");
const { getRepaymentScoreDelta, updateCreditScore } = require("./creditScore");

// Agent Commission Handler for Full Repayment
const handleAgentFullRepaymentCommission = async (loan, transaction, session) => {
  try {
    const FIXED_REPAYMENT_COMMISSION = 100;

    const query = {
      agentId: loan.requestedByAgentId,
      loanId: loan._id,
      commissionType: "full_repayment",
    };

    // Check if commission already exists to prevent duplicates
    const existingCommission = session
      ? await AgentCommission.findOne(query).session(session)
      : await AgentCommission.findOne(query);

    if (existingCommission) {
      console.log(`[REPAYMENT_SERVICE] 🔄 Full repayment commission already exists for agent ${loan.requestedByAgentId} and loan ${loan._id}`);
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
      earnedAt: new Date(),
    });

    if (session) {
      await commission.save({ session });
    } else {
      await commission.save();
    }

    console.log(`[REPAYMENT_SERVICE] 💰 Full repayment commission of KES ${FIXED_REPAYMENT_COMMISSION} recorded for agent ${loan.requestedByAgentId}`);

    const agent = session
      ? await AgentModel.findById(loan.requestedByAgentId).session(session)
      : await AgentModel.findById(loan.requestedByAgentId);

    if (agent) {
      agent.walletBalance = (agent.walletBalance || 0) + FIXED_REPAYMENT_COMMISSION;
      if (session) {
        await agent.save({ session });
      } else {
        await agent.save();
      }
      console.log(`[REPAYMENT_SERVICE] 💰 Commission added to agent wallet: KES ${FIXED_REPAYMENT_COMMISSION}`);
    }
  } catch (error) {
    console.error("[REPAYMENT_SERVICE] ❌ Error handling agent full repayment commission:", error.message);
    throw error;
  }
};

/**
 * Processes a successful repayment and executes all business logic.
 * Shares functionality between the webhook callback controller and the payment reconciliation recovery service.
 */
const processRepayment = async (transaction, amount, mpesaReceipt, session) => {
  console.log(`[REPAYMENT_SERVICE] Processing repayment for transaction ID: ${transaction._id}, Amount: ${amount}`);

  const loan = session
    ? await Loan.findById(transaction.loanId).session(session)
    : await Loan.findById(transaction.loanId);

  const borrower = session
    ? await Customer.findById(transaction.userId).session(session)
    : await Customer.findById(transaction.userId);

  if (!loan || !borrower) {
    throw new Error("Loan or Borrower not found");
  }

  transaction.balanceBefore = loan.balance;
  transaction.status = "Paid"; // Set status to Paid as requested by the system
  transaction.transactionId = mpesaReceipt || transaction.transactionId;

  /* 1️⃣ Apply repayment */
  loan.repaidAmount = (loan.repaidAmount || 0) + amount;
  loan.balance -= amount;
  loan.principalPaid = Math.max(0, loan.repaidAmount - (loan.interest || 0));

  let event = "ON_TIME";
  let daysLate = 0;

  /* 2️⃣ Late check */
  if (loan.dueDate && new Date() > loan.dueDate && loan.balance > 0) {
    event = "LATE";
    daysLate = Math.ceil((new Date() - loan.dueDate) / (1000 * 60 * 60 * 24));
  }

  /* 3️⃣ Credit score update */
  const scoreDelta = getRepaymentScoreDelta(loan, borrower, amount, new Date());
  const { newScore } = updateCreditScore(
    borrower,
    
    scoreDelta,
    event === "LATE" ? `Late repayment (${daysLate} days)` : "On-time repayment"
  );

  if (event === "LATE") {
    borrower.latePayments = (borrower.latePayments || 0) + 1;
  }

  /* 4️⃣ Save repayment history */
  loan.repayments.push({
    loanId: loan._id,
    transactionId: transaction._id,
    borrowerId: borrower._id,
    amount,
    date: new Date(),
    expectedPaymentDate: loan.dueDate,
    wasPaymentLate: event === "LATE",
    daysLate,
    creditScoreDelta: scoreDelta,
  });

  /* 5️⃣ Fully paid check */
  let isFullyPaid = false;
  if (loan.balance <= 0) {
    loan.balance = 0;
    loan.status = "fully paid";
    loan.creditScoreAfter = newScore;
    isFullyPaid = true;
  }

  if (session) {
    await loan.save({ session });
  } else {
    await loan.save();
  }

  /* 6️⃣ Credit lender wallet */
  const lender = session
    ? await User.findById(loan.lenderId).session(session)
    : await User.findById(loan.lenderId);

  if (lender) {
    lender.walletBalance = (lender.walletBalance || 0) + amount;
    if (session) {
      await lender.save({ session });
    } else {
      await lender.save();
    }
  }

  borrower.loanBalance = loan.balance;
  
  if (isFullyPaid) {
    borrower.totalLoansRepaid = (borrower.totalLoansRepaid || 0) + 1;
    borrower.completedLoans = (borrower.completedLoans || 0) + 1;
  }

  try {
    if (session) {
      await borrower.save({ session, validateModifiedOnly: true });
    } else {
      await borrower.save({ validateModifiedOnly: true });
    }
  } catch (saveErr) {
    console.warn("[REPAYMENT_SERVICE] ⚠️ Borrower save failed with validation error, retrying without validation:", saveErr.message);
    if (session) {
      await borrower.save({ session, validateBeforeSave: false });
    } else {
      await borrower.save({ validateBeforeSave: false });
    }
  }

  // 📩 Send Customer Notification SMS (Full Clearance or Partial Repayment)
  try {
    const customerPhone = borrower.phone || loan.phoneNumber;
    const customerName = borrower.fullName || loan.fullName || "Valued Customer";
    if (customerPhone) {
      if (isFullyPaid) {
        await sendSMS(
          customerPhone,
          `IziFinance – Congratulations!\nWell done ${customerName} 🎉\nYou have fully cleared your loan.\nYour new loan limit has been updated.\nPlease check your IziFinance app to see your new limit.`
        );
      } else {
        const refText = mpesaReceipt ? ` Ref: ${mpesaReceipt}.` : "";
        await sendSMS(
          customerPhone,
          `Dear ${customerName}, your repayment of KES ${amount} was received.${refText} Remaining balance: KES ${loan.balance}. Thank you for using IziFinance.`
        );
      }
    }
  } catch (smsErr) {
    console.error("[REPAYMENT_SERVICE] ⚠️ Failed to send repayment confirmation SMS to customer:", smsErr.message);
  }

  transaction.balanceAfter = loan.balance;

  /* 7️⃣ Lender notification */
  const notificationPayload = {
    userId: loan.lenderId,
    userModel: "User",
    title: isFullyPaid ? "Loan Fully Repaid" : "Loan Repayment Received",
    message: isFullyPaid
      ? `Loan fully repaid by ${borrower.fullName}`
      : `KES ${amount} received from ${borrower.fullName}. Balance: KES ${loan.balance}`,
    type: "repayment",
    data: {
      loanId: loan._id,
      borrowerId: borrower._id,
      amountPaid: amount,
      remainingBalance: loan.balance,
      transactionId: transaction._id,
    },
  };

  if (session) {
    await Notification.create([notificationPayload], { session });
  } else {
    await Notification.create(notificationPayload);
  }

  /* 8️⃣ Agent commission */
  if (isFullyPaid && loan.requestedByAgentId) {
    await handleAgentFullRepaymentCommission(loan, transaction, session);
  }

  if (session) {
    await transaction.save({ session });
  } else {
    await transaction.save();
  }

  console.log(`[REPAYMENT_SERVICE] ✅ Repayment processed successfully for transaction: ${transaction._id}`);
};

module.exports = {
  processRepayment,
  handleAgentFullRepaymentCommission,
};
