const GroupLoanRequest = require("../models/GroupLoanRequest");
const Group = require("../models/Group");
const GroupMember = require("../models/GroupMember");
const Customer = require("../models/customer");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const { initiateB2C, initiateSTKPush } = require("../utils/mpesa");
const { getB2CCharge } = require("../utils/mpesaCharges");
const { normalizePhone } = require("../utils/phone");
const mongoose = require("mongoose");

/* =========================
   CREATE GROUP LOAN REQUEST (LEADER)
========================= */
exports.createGroupLoanRequest = async (req, res) => {
  try {
    const { groupId, borrowerId, leaderId, amount } = req.body;

    if (!groupId || !borrowerId || !leaderId || !amount) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // 1. Verify Group exists and get its policy
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: "Group not found" });

    // 2. Verify Borrower is in that group
    const isMember = await GroupMember.findOne({ groupId, borrowerId });
    if (!isMember) return res.status(400).json({ message: "Borrower is not a member of this group" });

    // 3. Verify requester is the Group Leader
    if (group.group_leader_id.toString() !== leaderId) {
      return res.status(401).json({ message: "Only the group leader can request loans for members" });
    }

    // 4. Calculations based on Group's monthly interest and duration
    const monthlyRate = group.interest_rate / 100; // e.g., 0.5 -> 0.005
    const durationMonths = group.duration_months || 1; // Default to 1 if not set
    const totalDurationDays = durationMonths * 30; // standard 30 day month estimate

    const totalInterest = amount * monthlyRate * durationMonths;
    const totalRepayment = amount + totalInterest;

    // Daily Repayment calculation
    const dailyRepayment = totalRepayment / totalDurationDays;

    const loanRequest = await GroupLoanRequest.create({
      groupId,
      borrowerId,
      requestedById: leaderId,
      amount,
      interest_rate: group.interest_rate,
      total_repayment: Math.ceil(totalRepayment),
      daily_repayment: Number(dailyRepayment.toFixed(2)),
      status: "pending"
    });

    res.status(201).json({
      success: true,
      message: "Loan request submitted to lender",
      request: loanRequest
    });

  } catch (error) {
    console.error("❌ createGroupLoanRequest error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   GET LENDER GROUP LOAN REQUESTS
========================= */
exports.getLenderGroupLoanRequests = async (req, res) => {
  try {
    const lenderId = req.user._id;

    // Find all groups belonging to this lender
    const groups = await Group.find({ lenderId }).select("_id");
    const groupIds = groups.map(g => g._id);

    // Fetch requests for those groups
    const requests = await GroupLoanRequest.find({ groupId: { $in: groupIds } })
      .populate("groupId", "name")
      .populate("borrowerId", "fullName phone")
      .populate("requestedById", "fullName")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: requests.length,
      requests
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   REVIEW GROUP LOAN REQUEST (LENDER)
========================= */
exports.reviewGroupLoanRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { requestId, status, reason } = req.body;
    const lenderId = req.user._id;

    if (!requestId || !status) {
      return res.status(400).json({ message: "requestId and status are required" });
    }

    // 1. Find the request
    const request = await GroupLoanRequest.findById(requestId).session(session);
    if (!request) throw new Error("Request not found");

    if (request.status !== "pending") {
      throw new Error("Request has already been processed");
    }

    // 2. Find the group and verify lender
    const group = await Group.findById(request.groupId).session(session);
    if (!group) throw new Error("Parent group not found");

    if (group.lenderId.toString() !== lenderId.toString()) {
      throw new Error("You are not authorized to review this request");
    }

    // 3. Handle rejection
    if (status === "rejected") {
      request.status = "rejected";
      request.rejectionReason = reason || "Lender rejected the request";
      await request.save({ session });
      await session.commitTransaction();
      session.endSession();
      return res.json({ success: true, message: "Request rejected" });
    }

    // 4. Handle approval (Disbursement)
    if (status === "approved") {
      // Find borrower for phone
      const borrower = await Customer.findById(request.borrowerId).session(session);
      if (!borrower) throw new Error("Borrower not found");

      const phone = borrower.phone || borrower.phoneNumber;
      if (!phone) throw new Error("Borrower has no phone number for disbursement");

      // Verify lender balance
      const amount = request.amount;
      const b2cFee = getB2CCharge(amount);
      const totalDebit = amount + b2cFee;

      const lender = await User.findById(lenderId).session(session);
      if (lender.walletBalance < totalDebit) {
        throw new Error(`Insufficient wallet balance. Total required: ${totalDebit}`);
      }

      // Create Pending Transaction
      const [transaction] = await Transaction.create([
        {
          userId: lenderId,
          userModel: "User",
          loanId: null, // We'll link this to the group loan request
          groupLoanRequestId: request._id,
          type: "group loan issued",
          amount: amount,
          status: "pending",
          phone: phone,
          description: `Group Loan Disbursement for ${borrower.fullName}`
        }
      ], { session });

      // Call B2C
      const b2cResponse = await initiateB2C(phone, amount, transaction._id);

      if (!b2cResponse?.OriginatorConversationID) {
        throw new Error("M-Pesa B2C initiation failed");
      }

      // Update request and transaction (Wait for callback)
      request.status = "processing";
      transaction.checkoutRequestID = b2cResponse.OriginatorConversationID;

      await request.save({ session });
      await transaction.save({ session });

      await session.commitTransaction();
      session.endSession();

      return res.json({
        success: true,
        message: "Loan approved and B2C disbursement initiated",
        originatorConversationID: b2cResponse.OriginatorConversationID
      });
    }

    throw new Error("Invalid status provided");

  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    res.status(400).json({ message: error.message });
  }
};

/* =========================
   MEMBER REPAYMENT (INITIATE STK PUSH)
========================= */
exports.initiateMemberRepayment = async (req, res) => {
  try {
    const { borrowerId, groupId, amount } = req.body;

    if (!borrowerId || !groupId || !amount) {
      return res.status(400).json({ message: "borrowerId, groupId, and amount are required" });
    }

    // 1. Verify existence
    const borrower = await Customer.findById(borrowerId);
    if (!borrower) throw new Error("Borrower not found");

    const group = await Group.findById(groupId);
    if (!group) throw new Error("Group not found");

    const member = await GroupMember.findOne({ groupId, borrowerId });
    if (!member) throw new Error("Member not found in this group");

    // 2. Normalize phone
    const phone = normalizePhone(borrower.phone || borrower.phoneNumber);
    if (!phone) throw new Error("Invalid borrower phone number");

    // 3. Create Pending Transaction
    const accountRef = `GRP-PAY-${group._id.toString().slice(-4)}-${borrower.fullName.slice(0, 5)}`;
    
    const transaction = new Transaction({
      type: "group member repayment",
      userId: borrowerId,
      userModel: "Customer",
      groupId: groupId, // Note: I should add this to the Transaction schema too!
      amount: amount,
      phone: phone,
      status: "pending",
      accountReference: accountRef,
      description: `Group Loan Repayment - ${group.name}`
    });

    await transaction.save();

    // 4. Initiate STK Push
    const b2cResponse = await initiateSTKPush(phone, amount, accountRef);

    if (b2cResponse?.CheckoutRequestID) {
      transaction.checkoutRequestID = b2cResponse.CheckoutRequestID;
      await transaction.save();
    }

    res.status(200).json({
      success: true,
      message: "Repayment initiated. Check your phone for STK push.",
      checkoutRequestID: b2cResponse.CheckoutRequestID
    });

  } catch (error) {
    console.error("❌ initiateMemberRepayment error:", error);
    res.status(400).json({ message: error.message });
  }
};


