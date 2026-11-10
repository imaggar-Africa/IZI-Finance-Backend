// controllers/c2bController.js
const mongoose = require("mongoose");
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

    // 🔥 Hardcoded fallback URLs
    const fallbackValidateUrl =
      "https://api-qqxc6zwzmq-uc.a.run.app/api/c2b/validate";

    const fallbackConfirmUrl =
      "https://api-qqxc6zwzmq-uc.a.run.app/api/c2b/confirm";

    // 🔥 Use secret → otherwise fallback
    const shortCode = (global.config.mpesaShortcode || "").trim();
    const validateUrl =
      (global.config.mpesaC2bValidateUrl || fallbackValidateUrl).trim();
    const confirmUrl =
      (global.config.mpesaC2bConfirmUrl || fallbackConfirmUrl).trim();

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

    const payload = {
      ShortCode: shortCode,
      ResponseType: "Completed",
      ConfirmationURL: confirmUrl,
      ValidationURL: validateUrl,
    };

    console.log("📌 Registering C2B with:", {
      mode,
      url,
      payload,
    });

    const { data } = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 20000,
    });

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
    console.error("❌ Register Error:", err.response?.data || err.message);

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
    console.log("📩 Validation Callback:", req.body);

    const billRefNumber = (req.body?.BillRefNumber || "").trim();
    const amount = Number(req.body?.TransAmount || 0);

    if (!billRefNumber) {
      return res.status(200).json({
        ResultCode: 1,
        ResultDesc: "Missing BillRefNumber",
      });
    }

    // 1️⃣ Find Customer by National ID
    const customer = await Customer.findOne({ idNumber: billRefNumber });

    // -------------------------
    // CUSTOMER NOT FOUND
    // -------------------------
    if (!customer) {
      console.warn("⚠️ Customer not found. No SMS sent (MSISDN is hashed).");

      return res.status(200).json({
        ResultCode: 0,  // Always ACCEPT money
        ResultDesc: "Customer not found — Payment accepted"
      });
    }

    // 2️⃣ Find Loan linked to this customer and ID
    const loan = await Loan.findOne({
      borrowerId: customer._id,
      status: { $in: ["active", "overdue"] },
      billRefNumber: billRefNumber
    });
    // 👉 Block payments for loans that are still pending approval
    if (loan && loan.loanRequestStatus === "processing") {
      console.warn(`⚠️ Loan ${loan._id} is pending. Rejecting C2B validation.`);
      return res.status(200).json({
        ResultCode: 1,
        ResultDesc: "Loan pending – payment not accepted",
      });
    }

    // -------------------------
    // LOAN NOT FOUND → CHECK GROUP LOAN
    // -------------------------
    if (!loan) {
      const member = await GroupMember.findOne({
        borrowerId: customer._id,
        remaining_balance: { $gt: 0 }
      });

      if (!member) {
        console.warn("⚠️ No individual or group loan found for this customer");

        await sendSMS(
          customer.phone,
          `Thank you ${customer.fullName} for making a payment to IziFinance. No active loan was found. Please contact support to confirm your balance.`
        );

        return res.status(200).json({
          ResultCode: 0, // STILL accept payment
          ResultDesc: "Loan not found — Payment accepted"
        });
      }
    }

    // -------------------------
    // LOAN FOUND → VALIDATION SUCCESS
    // -------------------------
    await sendSMS(
      customer.phone,
      `Hello ${customer.fullName}, your payment of KES ${amount} has been validated successfully.`
    );

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Validation Passed"
    });

  } catch (error) {
    console.error("❌ Validation Error:", error);
    return res.status(200).json({
      ResultCode: 1,
      ResultDesc: "Server Error"
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
  console.log("💰 Payment Confirmation Callback:", req.body);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const BillRefNumber = req.body?.BillRefNumber?.trim();
    const Amount = Number(req.body?.TransAmount) || 0;
    const MpesaTransactionId = req.body?.TransID;

    if (!BillRefNumber || !Amount) {
      return res.status(200).json({
        ResultCode: 1,
        ResultDesc: "Missing BillRef or Amount"
      });
    }

    // 1️⃣ FIND CUSTOMER
    const customer = await Customer.findOne({ idNumber: BillRefNumber }).session(session);

    if (!customer) {
      console.warn("⚠️ Customer not found. NO SMS sent (MSISDN is hashed in sandbox).");

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: "Customer not found – Payment accepted"
      });
    }

    // Disable mongoose validation for customer during C2B to avoid required field errors (e.g. livePhoto, frontID, backID)
    customer.set('validateBeforeSave', false);

    // 2️⃣ FIND LOAN FOR THIS CUSTOMER
    const loan = await Loan.findOne({
      borrowerId: customer._id,
      status: { $in: ["active", "overdue"] },
      billRefNumber: BillRefNumber
    }).session(session);
    // 👉 Ensure pending loans are not processed
    if (loan && loan.status === "pending") {
      console.warn(`⚠️ Loan ${loan._id} is pending. Rejecting C2B confirmation.`);
      await session.abortTransaction();
      session.endSession();
      return res.status(200).json({
        ResultCode: 1,
        ResultDesc: "Loan pending – payment not accepted",
      });
    }

    // 3️⃣ IF LOAN NOT FOUND → CHECK GROUP LOAN
    if (!loan) {
      const member = await GroupMember.findOne({
        borrowerId: customer._id,
        remaining_balance: { $gt: 0 }
      }).session(session);

      if (!member) {
        console.warn("⚠️ No active loan found for this customer. Sending SMS.");

        await sendSMS(
          customer.phone,
          `Thank you ${customer.fullName} for your payment to IziFinance. No active loan was found. Please contact support to confirm your balance.`
        );

        await session.commitTransaction();
        session.endSession();
        return res.status(200).json({
          ResultCode: 0,
          ResultDesc: "Loan not found – Payment accepted"
        });
      }

      // 4️⃣ GROUP LOAN MEMBER FOUND → PROCESS REPAYMENT
      const group = await Group.findById(member.groupId).session(session);
      if (!group) throw new Error("Group not found");

      member.total_repaid += Amount;
      member.remaining_balance -= Amount;
      if (member.remaining_balance < 0) member.remaining_balance = 0;

      group.remaining_loan_balance -= Amount;
      if (group.remaining_loan_balance < 0) group.remaining_loan_balance = 0;

      // Credit Lender Wallet
      const lender = await User.findById(group.lenderId).session(session);
      if (lender) {
        lender.walletBalance += Amount;
        await lender.save({ session });
      }

      await member.save({ session });
      await group.save({ session });

      // Record Transaction
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
        description: `C2B Group Repayment - ${group.name}`
      });

      // 🔥 Update GroupLoanRequest Repayments Array
      const GroupLoanRequest = require("../models/GroupLoanRequest");
      const activeRequest = await GroupLoanRequest.findOne({
        groupId: group._id,
        borrowerId: customer._id,
        status: "approved"
      }).session(session);

      if (activeRequest) {
        activeRequest.repayments.push({
          transactionId: transaction._id,
          amount: Amount,
          date: new Date()
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

      // 🔔 Add Push Notification for Group Repayment
      await Notification.create({
        userId: customer._id,
        userModel: "Customer",
        title: "Group Repayment Received",
        message: `KES ${Amount} repaid for ${group.name}. Balance: KES ${member.remaining_balance}`,
        type: "repayment"
      });
      console.log(`🔔 Push Notification Sent to Member: ${customer.fullName} for C2B group payment`);

      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: "Group payment processed successfully"
      });
    }

    // 5️⃣ NORMAL LOAN FOUND → PROCESS REPAYMENT
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
      description: `C2B Loan Repayment via Paybill - Ref: ${BillRefNumber}`
    });

      const { processRepayment } = require("../utils/repaymentService");
      await processRepayment(transaction, Amount, MpesaTransactionId, session);

      await session.commitTransaction();
      session.endSession();

      // Fetch the updated loan after committing the transaction
      const updatedLoan = await Loan.findById(loan._id);
      if (updatedLoan) {
        console.log(`ℹ️ [C2B_CONFIRMATION] Loan successfully updated. Loan ID: ${updatedLoan._id}, Previous Balance: ${loan.balance}, New Balance: ${updatedLoan.balance}`);
      } else {
        console.warn(`⚠️ [C2B_CONFIRMATION] Fetching updated loan failed for Loan ID: ${loan._id}`);
      }

      // Send SMS Notification to Customer
      await sendSMS(
        customer.phone,
        `Dear ${customer.fullName}, your repayment of KES ${Amount} was received. Remaining balance: KES ${updatedLoan ? updatedLoan.balance : 'unknown'}. Ref: ${MpesaTransactionId}`
      );

      // Agent SMS if fully paid (commission already handled in repaymentService)
      if (updatedLoan.balance <= 0 && updatedLoan.requestedByAgentId) {
        const agent = await AgentModel.findById(updatedLoan.requestedByAgentId);
        if (agent) {
          await sendSMS(
            agent.phone,
            `🎉 Borrower ${customer.fullName} has fully repaid their loan. Your commission has been recorded.`
          );
        }
        // No need to call handleAgentFullRepaymentCommission here as it is handled in repaymentService
      }

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Payment processed successfully"
    });

  } catch (error) {
    console.error("❌ Confirmation Error:", error);
    console.error("❌ C2B Confirmation Failed details:", {
      message: error.message,
      stack: error.stack,
      requestBody: req.body
    });

    await session.abortTransaction();
    session.endSession();

    return res.status(200).json({
      ResultCode: 1,
      ResultDesc: "Transaction failed"
    });
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





