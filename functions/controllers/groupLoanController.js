const GroupLoanRequest = require("../models/GroupLoanRequest");
const Group = require("../models/Group");
const GroupMember = require("../models/GroupMember");
const Customer = require("../models/customer");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const { initiateB2C, initiateSTKPush } = require("../utils/mpesa");
const { getB2CCharge } = require("../utils/mpesaCharges");
const { normalizePhone } = require("../utils/phone");
const Notification = require("../models/Notification");
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
      lenderId: group.lenderId,
      agentId: group.agentId,
      requestedById: leaderId,
      amount,
      interest_rate: group.interest_rate,
      total_repayment: Math.ceil(totalRepayment),
      daily_repayment: Number(dailyRepayment.toFixed(2)),
      agentReview: group.createdByModel === "User", // If lender created group, auto-reviewed
      agent_status: group.createdByModel === "User" ? "approved" : "pending",
      status: "pending"
    });

    // 🔔 Push Notifications
    if (group.createdByModel === "Agent" && group.createdBy) {
      // Notify Agent to review
      await Notification.create({
        userId: group.createdBy,
        userModel: "Agent",
        title: "New Loan Request (Review Required)",
        message: `A new loan request for ${group.name} is pending your review.`,
        type: "general",
      });
    } else if (group.createdByModel === "User" && group.lenderId) {
      // Notify Lender directly
      await Notification.create({
        userId: group.lenderId,
        userModel: "User",
        title: "New Loan Request",
        message: `A new loan request for ${group.name} was submitted.`,
        type: "general",
      });
    }

    res.status(201).json({
      success: true,
      message: (group.createdByModel === "User") ? "Loan request submitted to lender" : "Loan request sent to agent for review",
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

    // Fetch requests for groups belonging to this lender that have been reviewed (or approved by agent)
    const requests = await GroupLoanRequest.find({ 
      lenderId: lenderId,
      agent_status: "approved" 
    })
      .populate("groupId", "name interest_rate duration_months description")
      .populate("borrowerId", "fullName phone")
      .populate("requestedById", "fullName")
      .populate("agentId", "name phone")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: requests.length,
      requests
    });

  } catch (error) {
    console.error("❌ getLenderGroupLoanRequests error:", error);
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

    console.log(`🔍 Reviewing Request: ${requestId} | Status: ${status} | By Lender: ${lenderId}`);

    if (!requestId || !status) {
      return res.status(400).json({ message: "requestId and status are required" });
    }

    // 1. Find the request
    const request = await GroupLoanRequest.findById(requestId).session(session);
    if (!request) {
      console.log(`❌ Request NOT FOUND: ${requestId}`);
      throw new Error("Request not found");
    }

    if (request.status !== "pending") {
      console.log(`❌ Request PROCESSED: Current Status ${request.status}`);
      throw new Error("Request has already been processed");
    }

    // 2. Find the group and verify lender
    const group = await Group.findById(request.groupId).session(session);
    if (!group) {
      console.log(`❌ Group NOT FOUND: ${request.groupId}`);
      throw new Error("Parent group not found");
    }

    if (group.lenderId.toString() !== lenderId.toString()) {
      console.log(`❌ UNAUTHORIZED: Lender ${lenderId} vs Group-Lender ${group.lenderId}`);
      throw new Error("You are not authorized to review this request");
    }

    // 3. Handle rejection
    if (status === "rejected") {
      console.log(`🚫 Rejecting Request: ${requestId}`);
      request.status = "rejected";
      request.rejectionReason = reason || "Lender rejected the request";
      await request.save({ session });
      await session.commitTransaction();
      session.endSession();

      // 🔔 Push Notification for Group Leader (requester)
      await Notification.create({
        userId: request.requestedById,
        userModel: "Customer",
        title: "Group Loan Request Rejected",
        message: `The loan request for group member in "${group.name}" was rejected.`,
        type: "general",
      });

      return res.json({ success: true, message: "Request rejected" });
    }


    // 4. Handle approval (Disbursement)
    if (status === "approved") {
      console.log(`✅ Approving Request: ${requestId} | Starting B2C...`);

      // Find borrower for phone
      const borrower = await Customer.findById(request.borrowerId).session(session);
      if (!borrower) {
        console.log(`❌ Borrower NOT FOUND: ${request.borrowerId}`);
        throw new Error("Borrower not found");
      }

      const phone = borrower.phone || borrower.phoneNumber;
      if (!phone) {
        console.log(`❌ Borrower No Phone: ${borrower.fullName}`);
        throw new Error("Borrower has no phone number for disbursement");
      }

      // Verify lender balance
      const amount = request.amount;
      const b2cFee = getB2CCharge(amount);
      const totalDebit = amount + b2cFee;

      console.log(`💰 DISBURSEMENT AUDIT: Amount ${amount} | Fee ${b2cFee} | Total Debit ${totalDebit}`);

      const lender = await User.findById(lenderId).session(session);
      if (lender.walletBalance < totalDebit) {
        console.log(`❌ INSUFFICIENT BALANCE: Wallet ${lender.walletBalance} vs Required ${totalDebit}`);
        throw new Error(`Insufficient wallet balance. Total required: ${totalDebit}`);
      }

      // Create Pending Transaction
      const [transaction] = await Transaction.create([
        {
          userId: lenderId,
          userModel: "User",
          loanId: null, 
          groupLoanRequestId: request._id,
          type: "group loan issued",
          amount: amount,
          status: "pending",
          phone: phone,
          description: `Group Loan Disbursement for ${borrower.fullName}`
        }
      ], { session });

      console.log(`📝 Transaction Created: ${transaction._id}. Calling Safaricom B2C...`);

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

    // 3. Find active loan request to link history
    const GroupLoanRequest = require("../models/GroupLoanRequest");
    const activeRequest = await GroupLoanRequest.findOne({
      groupId,
      borrowerId,
      status: "approved"
    });

    // 4. Create Pending Transaction
    const accountRef = `GRP-PAY-${group._id.toString().slice(-4)}-${borrower.fullName.slice(0, 5)}`;
    
    const transaction = new Transaction({
      type: "group member repayment",
      userId: borrowerId,
      userModel: "Customer",
      groupId: groupId,
      groupLoanRequestId: activeRequest ? activeRequest._id : null,
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

/* =========================
   GET AGENT GROUP LOAN REQUESTS
========================= */
exports.getAgentGroupLoanRequests = async (req, res) => {
  try {
    const agentId = req.user._id;

    // 1. Find all groups created by this agent
    const groups = await Group.find({ createdBy: agentId }).select("_id");
    const groupIds = groups.map(g => g._id);

    // 2. Fetch requests for those specific groups
    const requests = await GroupLoanRequest.find({ groupId: { $in: groupIds } })
      .populate("groupId", "name interest_rate duration_months description")
      .populate("borrowerId", "fullName phone")
      .populate("requestedById", "fullName")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: requests.length,
      requests
    });

  } catch (error) {
    console.error("❌ getAgentGroupLoanRequests error:", error);
    res.status(500).json({ message: error.message });
  }
};


/* =========================
   AGENT REVIEW GROUP LOAN REQUEST
========================= */

exports.agentReviewGroupLoanRequest = async (req, res) => {
  try {
    const { requestId, status } = req.body;
    const agentId = req.user._id;

    if (!requestId || !status) {
      return res.status(400).json({ message: "requestId and status are required" });
    }

    // 1. Find the request and populate group
    const request = await GroupLoanRequest.findById(requestId).populate("groupId");
    if (!request) return res.status(404).json({ message: "Group loan request not found" });

    const group = request.groupId;
    if (!group) return res.status(404).json({ message: "Parent group not found" });

    // 2. Verify agent belongs to this group/request (check creator)
    if (!group.createdBy || group.createdBy.toString() !== agentId.toString()) {
      return res.status(403).json({ message: "Unauthorized: You are not the creator of this group" });
    }

    // 3. Mark as reviewed by agent
    if (status === "approved") {
      request.agentReview = true;
      request.agent_status = "approved";

      // 🔔 Push Notification for Lender (forwarded)
      if (group.lenderId) {
        await Notification.create({
          userId: group.lenderId,
          userModel: "User",
          title: "New Loan Request (Agent Approved)",
          message: `Agent ${req.user.name} approved a loan request for ${group.name}. It is now pending your review.`,
          type: "general",
        });
      }

    } else if (status === "rejected") {
      request.agentReview = false;
      request.agent_status = "rejected";
      request.status = "rejected"; // If agent rejects, the whole request is rejected

      // 🔔 Push Notification for Group Leader (requester)
      await Notification.create({
        userId: request.requestedById,
        userModel: "Customer",
        title: "Loan Request Rejected by Agent",
        message: `The loan request for group member in "${group.name}" was rejected by the agent.`,
        type: "general",
      });
    } else {
      return res.status(400).json({ message: "Invalid status. Use 'approved' or 'rejected'" });
    }

    await request.save();

    res.json({
      success: true,
      message: status === "approved" ? "Request approved and forwarded to lender" : "Request rejected",
      request
    });

  } catch (error) {
    console.error("❌ agentReviewGroupLoanRequest error:", error);
    res.status(500).json({ message: error.message });
  }
};