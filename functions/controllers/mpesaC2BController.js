// controllers/c2bController.js
const {
  mongoose,
  waitForMongoReady,
} = require("../config/db");
const Loan = require("../models/Loan");
const Transaction = require("../models/Transaction");
const Customer = require("../models/customer");
const { sendSMS } = require("../utils/sms");
const User = require("../models/User");
const Notification = require("../models/Notification");
const Group = require("../models/Group");
const GroupMember = require("../models/GroupMember");
const { normalizePhone } = require("../utils/normalizePhone");

// functions/controllers/mpesaC2B.controller.js
const axios = require("axios");
const { getMpesaToken } = require("../utils/mpesaC2BService");
const AgentCommission = require("../models/AgentCommission");
const AgentModel = require("../models/AgentModel");
const Profile = require("../models/Profile");
const { getRepaymentScoreDelta, updateCreditScore } = require("../utils/creditScore");
const { notifyUser } = require("../utils/notifyUser");
const {
  resolveCustomerFromC2b,
  resolveActiveLoanForCustomer,
  resolveGroupMember,
  resolveC2bCallbackUrls,
} = require("../utils/c2bResolve");

async function closeC2bSession(session, commit) {
  try {
    if (session.inTransaction()) {
      if (commit) await session.commitTransaction();
      else await session.abortTransaction();
    }
  } finally {
    session.endSession();
  }
}

exports.registerC2B = async (req, res) => {
  try {
    const token = await getMpesaToken();

    const mode = (global.config.mpesaEnv || "sandbox")
      .trim()
      .toLowerCase();

    const url =
      mode === "live"
        ? "https://api.safaricom.co.ke/mpesa/c2b/v2/registerurl"
        : "https://sandbox.safaricom.co.ke/mpesa/c2b/v2/registerurl";

    const shortCode = (global.config.mpesaShortcode || "").trim();
    const { validateUrl, confirmUrl, source } = resolveC2bCallbackUrls(
      global.config
    );
    console.log("[C2B_REGISTER] callback_urls", {
      source,
      validateUrl,
      confirmUrl,
    });

    // ---- Validations ----
    if (!shortCode || shortCode.length < 5) {
      return res.status(400).json({
        success: false,
        message: `Shortcode is invalid or missing. Got: "${shortCode}"`,
      });
    }

    if (!confirmUrl.startsWith("https://")) {
      return res.status(400).json({
        success: false,
        message: `Confirmation URL must be HTTPS. Got: "${confirmUrl}"`,
      });
    }

    if (!validateUrl.startsWith("https://")) {
      return res.status(400).json({
        success: false,
        message: `Validation URL must be HTTPS. Got: "${validateUrl}"`,
      });
    }

    const shortCodeNum = parseInt(shortCode, 10);
    const payload = {
      ShortCode: Number.isNaN(shortCodeNum) ? shortCode : shortCodeNum,
      ResponseType: "Completed",
      ConfirmationURL: confirmUrl,
      ValidationURL: validateUrl,
    };

    console.log("📌 Registering C2B with:", {
      mode,
      url,
      payload,
    });

    const { data, status } = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 25000,
      validateStatus: () => true,
    });

    if (status < 200 || status >= 300) {
      const saf = data || {};
      console.error("[C2B_REGISTER] failed", { status, ...saf });
      return res.status(500).json({
        success: false,
        message: "Failed to register C2B URLs with Safaricom",
        environment: mode.toUpperCase(),
        registered: {
          ShortCode: shortCode,
          ConfirmationURL: confirmUrl,
          ValidationURL: validateUrl,
        },
        error: saf,
        hint:
          saf.errorCode === "500.003.1001"
            ? "On LIVE: delete existing URLs in Daraja → Self Service → URL Management for this paybill, then register again."
            : undefined,
      });
    }

    return res.json({
      success: true,
      message: "C2B URLs Registered Successfully",
      environment: mode.toUpperCase(),
      registered: {
        ShortCode: shortCode,
        ConfirmationURL: confirmUrl,
        ValidationURL: validateUrl,
      },
      safaricomResponse: data,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[C2B_REGISTER] error", err.response?.data || err.message);

    return res.status(500).json({
      success: false,
      message: "Failed to register C2B URLs",
      environment: global.config.mpesaEnv,
      error: err.response?.data || err.message,
    });
  }
};



// ---------------- VALIDATION ----------------
exports.validationHandler = async (req, res) => {
  try {
    await waitForMongoReady();
    const billRefNumber = (req.body?.BillRefNumber || "").trim();
    const amount = Number(req.body?.TransAmount || 0);
    const msisdn = req.body?.MSISDN;

    console.log("[C2B_VALIDATE]", {
      BillRefNumber: billRefNumber,
      TransAmount: amount,
      MSISDN: msisdn,
      TransID: req.body?.TransID,
    });

    if (!billRefNumber) {
      return res.status(200).json({
        ResultCode: 1,
        ResultDesc: "Missing BillRefNumber",
      });
    }

    const { customer, matchedBy } = await resolveCustomerFromC2b(
      billRefNumber,
      msisdn,
      null
    );

    if (!customer) {
      console.warn("[C2B_VALIDATE] customer_not_found", { billRefNumber, msisdn });
      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: "Customer not found — Payment accepted",
      });
    }

    console.log("[C2B_VALIDATE] customer_resolved", {
      customerId: String(customer._id),
      matchedBy,
    });

    const loan = await resolveActiveLoanForCustomer(
      customer,
      billRefNumber,
      null
    );

    if (loan && loan.loanRequestStatus === "processing") {
      console.warn("[C2B_VALIDATE] loan_processing_reject", { loanId: String(loan._id) });
      return res.status(200).json({
        ResultCode: 1,
        ResultDesc: "Loan pending – payment not accepted",
      });
    }

    if (!loan) {
      const member = await resolveGroupMember(customer, null);
      if (!member) {
        console.warn("[C2B_VALIDATE] no_active_loan", {
          customerId: String(customer._id),
        });
        if (customer.phone) {
          await sendSMS(
            customer.phone,
            `Thank you ${customer.fullName} for your payment to IziFinance. No active loan was found. Use your National ID as the paybill account number. Contact support if needed.`
          );
        }
        return res.status(200).json({
          ResultCode: 0,
          ResultDesc: "Loan not found — Payment accepted",
        });
      }
    }

    if (customer.phone) {
      await sendSMS(
        customer.phone,
        `Hello ${customer.fullName}, your payment of KES ${amount} to IziFinance was validated. Ref will be sent after confirmation.`
      );
    }

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Validation Passed",
    });
  } catch (error) {
    console.error("[C2B_VALIDATE] error", { error: error.message });
    return res.status(200).json({
      ResultCode: 1,
      ResultDesc: "Server Error",
    });
  }
};






// ---------------- CONFIRMATION ----------------
const handleAgentFullRepaymentCommission = async (loan, transaction, session) => {
  try {
    const FIXED_REPAYMENT_COMMISSION = 100;

    const existingCommission = await AgentCommission.findOne({
      agentId: loan.requestedByAgentId,
      loanId: loan._id,
      commissionType: "full_repayment",
    }).session(session);

    if (existingCommission) return;

    const commission = new AgentCommission({
      agentId: loan.requestedByAgentId,
      loanId: loan._id,
      commissionType: "full_repayment",
      amount: FIXED_REPAYMENT_COMMISSION,
      status: "earned",
      transactionId: transaction._id,
      earnedAt: new Date(),
    });

    await commission.save({ session });

    // Add to agent wallet
    const agent = await AgentModel.findById(loan.requestedByAgentId).session(session);
    if (agent) {
      agent.walletBalance += FIXED_REPAYMENT_COMMISSION;
      await agent.save({ session });
    }

  } catch (error) {
    console.error("❌ Error handling agent full repayment commission:", error);
  }
};

exports.confirmationHandler = async (req, res) => {
  const BillRefNumber = req.body?.BillRefNumber?.trim();
  const Amount = Number(req.body?.TransAmount) || 0;
  const MpesaTransactionId = req.body?.TransID;
  const msisdn = req.body?.MSISDN;

  console.log("[C2B_CONFIRM] received", {
    BillRefNumber,
    TransAmount: Amount,
    TransID: MpesaTransactionId,
    MSISDN: msisdn,
  });

  let session;
  try {
    await waitForMongoReady();
    session = await mongoose.startSession();
    session.startTransaction();
    if (!BillRefNumber || !Amount) {
      await closeC2bSession(session, false);
      return res.status(200).json({
        ResultCode: 1,
        ResultDesc: "Missing BillRef or Amount",
      });
    }

    const { customer, matchedBy } = await resolveCustomerFromC2b(
      BillRefNumber,
      msisdn,
      session
    );

    if (!customer) {
      console.warn("[C2B_CONFIRM] customer_not_found", {
        BillRefNumber,
        MSISDN: msisdn,
        TransID: MpesaTransactionId,
        hint: "Paybill account must be customer National ID (idNumber), not paybill number",
      });
      await closeC2bSession(session, false);
      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: "Customer not found – Payment accepted",
      });
    }

    console.log("[C2B_CONFIRM] customer_resolved", {
      customerId: String(customer._id),
      matchedBy,
    });

    customer.set("validateBeforeSave", false);

    const loan = await resolveActiveLoanForCustomer(
      customer,
      BillRefNumber,
      session
    );

    if (loan && loan.status === "pending") {
      console.warn("[C2B_CONFIRM] loan_pending_reject", {
        loanId: String(loan._id),
      });
      await closeC2bSession(session, false);
      return res.status(200).json({
        ResultCode: 1,
        ResultDesc: "Loan pending – payment not accepted",
      });
    }

    if (!loan) {
      const member = await resolveGroupMember(customer, session);

      if (!member) {
        console.warn("[C2B_CONFIRM] no_active_loan", {
          customerId: String(customer._id),
          Amount,
          TransID: MpesaTransactionId,
        });

        await closeC2bSession(session, true);

        if (customer.phone) {
          await sendSMS(
            customer.phone,
            `Thank you ${customer.fullName} for your payment of KES ${Amount} to IziFinance (Ref: ${MpesaTransactionId}). No active loan was matched. Use your National ID as the paybill account number. Contact support to allocate this payment.`
          );
        }

        await notifyUser({
          userId: customer._id,
          userModel: "Customer",
          title: "Payment Received",
          message: `KES ${Amount} received (Ref: ${MpesaTransactionId}). We could not match an active loan. Support will review.`,
          type: "general",
          context: "c2b_unmatched_loan",
        });

        return res.status(200).json({
          ResultCode: 0,
          ResultDesc: "Loan not found – Payment accepted",
        });
      }

      const group = await Group.findById(member.groupId).session(session);
      if (!group) throw new Error("Group not found");

      member.total_repaid += Amount;
      member.remaining_balance -= Amount;
      if (member.remaining_balance < 0) member.remaining_balance = 0;

      group.remaining_loan_balance -= Amount;
      if (group.remaining_loan_balance < 0) group.remaining_loan_balance = 0;

      const lender = await User.findById(group.lenderId).session(session);
      if (lender) {
        lender.walletBalance += Amount;
        await lender.save({ session });
      }

      await member.save({ session });
      await group.save({ session });

      const transaction = new Transaction({
        type: "group member repayment",
        userId: customer._id,
        userModel: "Customer",
        groupId: group._id,
        amount: Amount,
        transactionId: MpesaTransactionId,
        status: "successful",
        phone: req.body?.MSISDN || customer.phone || "Unknown",
        accountReference: BillRefNumber,
        description: `C2B Group Repayment - ${group.name}`,
      });

      const GroupLoanRequest = require("../models/GroupLoanRequest");
      const activeRequest = await GroupLoanRequest.findOne({
        groupId: group._id,
        borrowerId: customer._id,
        status: "approved",
      }).session(session);

      if (activeRequest) {
        activeRequest.repayments.push({
          transactionId: transaction._id,
          amount: Amount,
          date: new Date(),
        });
        await activeRequest.save({ session });
        transaction.groupLoanRequestId = activeRequest._id;
      }

      await transaction.save({ session });

      await session.commitTransaction();
      session.endSession();

      await sendSMS(
        customer.phone,
        `Dear ${customer.fullName}, your group repayment of KES ${Amount} for ${group.name} was received. Balance: KES ${member.remaining_balance}. Ref: ${MpesaTransactionId}`
      );

      await notifyUser({
        userId: customer._id,
        userModel: "Customer",
        title: "Group Repayment Received",
        message: `KES ${Amount} repaid for ${group.name}. Balance: KES ${member.remaining_balance}`,
        type: "repayment",
        context: "c2b_group_repayment",
      });

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: "Group payment processed successfully",
      });
    }

    if (loan && !loan.billRefNumber) {
      loan.billRefNumber = customer.idNumber || BillRefNumber;
      await loan.save({ session, validateBeforeSave: false });
    }

    const transaction = new Transaction({
      type: "repayment",
      userId: customer._id,
      userModel: "Customer",
      loanId: loan._id,
      amount: Amount,
      transactionId: MpesaTransactionId,
      status: "pending",
      phone: req.body?.MSISDN || customer.phone || "Unknown",
      accountReference: BillRefNumber,
      description: `C2B Loan Repayment via Paybill - Ref: ${BillRefNumber}`,
    });

    const { processRepayment } = require("../utils/repaymentService");
    await processRepayment(transaction, Amount, MpesaTransactionId, session);

    await session.commitTransaction();
    session.endSession();

    const updatedLoan = await Loan.findById(loan._id);
    if (updatedLoan) {
      console.log("[C2B_CONFIRM] loan_updated", {
        loanId: String(updatedLoan._id),
        newBalance: updatedLoan.balance,
      });
    }

    await sendSMS(
      customer.phone,
      `Dear ${customer.fullName}, your repayment of KES ${Amount} was received. Remaining balance: KES ${updatedLoan ? updatedLoan.balance : "unknown"}. Ref: ${MpesaTransactionId}`
    );

    const remaining = updatedLoan ? updatedLoan.balance : null;
    await notifyUser({
      userId: customer._id,
      userModel: "Customer",
      title: "Repayment Received",
      message:
        remaining != null
          ? `KES ${Amount} received. Remaining balance: KES ${remaining}. Ref: ${MpesaTransactionId}`
          : `KES ${Amount} repayment received. Ref: ${MpesaTransactionId}`,
      type: "repayment",
      context: "c2b_loan_repayment",
    });

    console.log("[C2B_CONFIRM] repayment_ok", {
      customerId: String(customer._id),
      loanId: String(loan._id),
      amount: Amount,
      remainingBalance: remaining,
      TransID: MpesaTransactionId,
    });

    if (updatedLoan?.balance <= 0 && updatedLoan.requestedByAgentId) {
      const agent = await AgentModel.findById(updatedLoan.requestedByAgentId);
      if (agent) {
        await sendSMS(
          agent.phone,
          `🎉 Borrower ${customer.fullName} has fully repaid their loan. Your commission has been recorded.`
        );
      }
    }

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Payment processed successfully",
    });
  } catch (error) {
    console.error("[C2B_CONFIRM] error", {
      message: error.message,
      stack: error.stack,
      BillRefNumber,
      TransID: MpesaTransactionId,
      body: req.body,
    });

    if (session) {
      await closeC2bSession(session, false);
    }

    if (!res.headersSent) {
      const transient =
        /not ready|buffering timed out|MongoNetworkError|ETIMEOUT/i.test(
          error.message
        );
      return res.status(200).json({
        ResultCode: transient ? 1 : 1,
        ResultDesc: transient
          ? "Server busy — Safaricom may retry"
          : "Transaction failed",
      });
    }
  }
};






// ---------------- SIMULATION ----------------
// ---------------- SIMULATION ----------------
exports.simulatePayment = async (req, res) => {
  try {
    const token = await getMpesaToken();

    const url = "https://sandbox.safaricom.co.ke/mpesa/c2b/v2/simulate";

    const rawPhone = req.body.phone || "+254708374149";
    const normalizedPhone = normalizePhone(rawPhone);

    if (!normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number for simulation"
      });
    }

    const payload = {
      ShortCode: global.config.mpesaShortcode,
      BillRefNumber: req.body.billRef || "TEST123",
      Amount: req.body.amount || "10",
      Msisdn: normalizedPhone.replace("+", ""), // M-Pesa requires no "+"
      CommandID: "CustomerPayBillOnline",
    };

    const { data } = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}` },
    });

    return res.json({
      success: true,
      message: "Simulation Sent",
      safaricom: data
    });

  } catch (err) {
    console.error("Simulation Error:", err.response?.data || err.message);
    return res.status(500).json({
      success: false,
      error: err.response?.data || err.message
    });
  }
};





