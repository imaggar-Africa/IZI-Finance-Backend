const mongoose = require("mongoose");
const Group = require("../models/Group");
const GroupMember = require("../models/GroupMember");
const Customer = require("../models/customer");
const User = require("../models/User");
const { sendSMS } = require("../utils/sms");
const Notification = require("../models/Notification");

/* =========================
   CREATE GROUP
========================= */
exports.createGroup = async (req, res) => {
  try {
    const { name, description, lenderId, agentId, group_leader_id, location } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Group name required" });
    }

    /* ===============================
       1️⃣ PREPARE GROUP DATA
    =============================== */

    let finalLenderId = lenderId;
    let finalAgentId = agentId;

    if (req.user.role === "agent") {
      finalAgentId = req.user._id;
      // Also get lenderId from agent's own data if possible
      const AgentModel = require("../models/AgentModel");
      const agent = await AgentModel.findById(finalAgentId);
      if (agent) finalLenderId = agent.lenderId;
    } else if (req.user.role === "lender" || req.user.role === "admin") {
      finalLenderId = req.user._id;
      finalAgentId = null;
    }


    const group = await Group.create({
      name,
      description,
      lenderId: finalLenderId,
      agentId: finalAgentId,
      createdBy: req.user._id,
      createdByModel: req.user.role === "agent" ? "Agent" : "User",
      group_leader_id,
      location,
      status: req.user.role === "agent" ? "pending" : "active"
    });


    // 🔔 Push Notifications
    if (req.user.role === "agent") {
      // Notify Agent
      await Notification.create({
        userId: req.user._id,
        userModel: "Agent",
        title: "Group Created Successfully",
        message: `You have successfully created the group "${group.name}".`,
        type: "general",
      });

      // Notify Lender
      if (finalLenderId) {
        await Notification.create({
          userId: finalLenderId,
          userModel: "User",
          title: "New Group Created by Agent",
          message: `Agent created a new group "${group.name}".`,
          type: "general",
        });
      }
    }

    res.status(201).json({
      success: true,
      group
    });


  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   ADD BORROWER TO GROUP
========================= */
exports.addMember = async (req, res) => {
  try {
    const groupId = req.params.groupId || req.body.groupId;
    const { borrowerId } = req.body;

    if (!groupId || !borrowerId) {
      return res.status(400).json({ message: "groupId and borrowerId are required" });
    }

    /* ===============================
       1️⃣ VALIDATE GROUP EXISTS
    =============================== */
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    const borrowerIds = Array.isArray(borrowerId) ? borrowerId : [borrowerId];
    const addedMembers = [];
    const skippedBorrowers = [];

    for (const id of borrowerIds) {
      const borrower = await Customer.findById(id);
      if (!borrower) continue;

      /* ===============================
         2️⃣ CHECK FOR DUPLICATE
      =============================== */
      const exists = await GroupMember.findOne({ groupId, borrowerId: id });
      if (exists) {
        skippedBorrowers.push(borrower.fullName);
        continue;
      }

      /* ===============================
         3️⃣ CREATE WITH INITIAL VALUES
      =============================== */
      const member = await GroupMember.create({
        groupId,
        borrowerId: id,
        internal_loan_amount: null,
        daily_repayment_amount: null,
        total_repaid: 0,
        remaining_balance: null,
        status: "active"
      });

      addedMembers.push(member);

      /* ===============================
         4️⃣ SEND SMS
      =============================== */
      const members = await GroupMember.find({ groupId })
        .populate("borrowerId", "fullName")
        .limit(10);

      const memberNames = members
        .filter(m => m.borrowerId)
        .map(m => m.borrowerId.fullName)
        .join(", ");

      const message = `You've been added to ${group.name} Group.\n\nTotal Members: ${members.length}\nMembers: ${memberNames}`;

      await sendSMS(borrower.phone, message);

      // 🔔 Push Notification for Member
      await Notification.create({
        userId: borrower._id,
        userModel: "Customer",
        title: "Added to Group",
        message: `You've been added to ${group.name} Group.\n\nTotal Members: ${members.length}`,
        type: "general",
      });

      // 🔔 Push Notification for Lender (if added by Agent)
      if (req.user.role === "agent" && group.lenderId) {
        await Notification.create({
          userId: group.lenderId,
          userModel: "User",
          title: "Member Added to Group",
          message: `Agent added ${borrower.fullName} to the group "${group.name}".`,
          type: "general",
        });
      }
    }


    if (addedMembers.length > 0) {
      await Group.findByIdAndUpdate(groupId, {
        $inc: { member_count: addedMembers.length }
      });
    }

    res.json({
      success: true,
      addedCount: addedMembers.length,
      addedMembers,
      skippedCount: skippedBorrowers.length,
      skippedBorrowers
    });

  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Customer already exists in this group" });
    }
    console.error("❌ addMember error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   ASSIGN/CHANGE GROUP LEADER
========================= */
exports.assignGroupLeader = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { group_leader_id } = req.body;

    if (!group_leader_id) {
      return res.status(400).json({ message: "group_leader_id is required" });
    }

    // Verify leader exists in Customer collection
    const leader = await Customer.findById(group_leader_id);
    if (!leader) {
      return res.status(404).json({ message: "Borrower not found for leader ID" });
    }

    // Optional: Check if leader is already a member of the group
    const isMember = await GroupMember.findOne({ groupId, borrowerId: group_leader_id });
    if (!isMember) {
      return res.status(400).json({ message: "Assigned leader must be a member of the group" });
    }

    const group = await Group.findByIdAndUpdate(
      groupId,
      { $set: { group_leader_id } },
      { new: true }
    );

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    res.json({
      success: true,
      message: "Group leader assigned/changed",
      group
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   GET GROUP MEMBERS
========================= */
exports.getGroupMembers = async (req, res) => {
  try {
    const { groupId } = req.params;

    const members = await GroupMember.find({ groupId })
      .populate("borrowerId", "fullName phone status internal_loan_amount daily_repayment_amount remaining_balance total_repaid");

    res.json({
      success: true,
      count: members.length,
      members: members.map(m => ({
        memberId: m._id,
        borrowerId: m.borrowerId?._id,
        fullName: m.borrowerId?.fullName,
        phone: m.borrowerId?.phone,
        status: m.status,
        internalLoan: m.internal_loan_amount,
        repaymentAmount: m.daily_repayment_amount,
        remainingBalance: m.remaining_balance,
        totalRepaid: m.total_repaid
      }))
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   GET ALL GROUP MEMBERS (LENDER)
========================= */
exports.getAllGroupMembers = async (req, res) => {
  try {
    const lenderId = req.user._id;

    // Use aggregate to find all members across all groups belonging to this lender
    const members = await GroupMember.aggregate([
      {
        $lookup: {
          from: "groups",
          localField: "groupId",
          foreignField: "_id",
          as: "group"
        }
      },
      { $unwind: "$group" },
      { $match: { "group.lenderId": new mongoose.Types.ObjectId(lenderId) } },
      {
        $lookup: {
          from: "customers",
          localField: "borrowerId",
          foreignField: "_id",
          as: "borrower"
        }
      },
      { $unwind: "$borrower" },
      {
        $project: {
          _id: 1,
          groupId: 1,
          groupName: "$group.name",
          borrowerId: 1,
          fullName: "$borrower.fullName",
          phone: "$borrower.phone",
          status: 1,
          internalLoan: "$internal_loan_amount",
          repaymentAmount: "$daily_repayment_amount",
          remainingBalance: "$remaining_balance",
          totalRepaid: "$total_repaid"
        }
      }
    ]);

    res.json({
      success: true,
      count: members.length,
      members
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   GET GROUPS BY AGENT ID
========================= */
exports.getGroupsByAgentId = async (req, res) => {
  try {
    const { agentId } = req.params;

    const groups = await Group.find({ agentId })
      .populate("group_leader_id", "fullName phone");

    res.json({
      success: true,
      count: groups.length,
      groups
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   REMOVE MEMBER
========================= */
exports.removeMember = async (req, res) => {
  try {
    const { groupId, borrowerId } = req.body;

    await GroupMember.deleteOne({ groupId, borrowerId });

    await Group.findByIdAndUpdate(groupId, {
      $inc: { member_count: -1 }
    });

    res.json({
      success: true,
      message: "Member removed"
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   GET GROUP DETAILS BY LEADER ID
========================= */
exports.getGroupByLeader = async (req, res) => {
  try {
    const { leaderId } = req.params;

    const group = await Group.findOne({ group_leader_id: leaderId })
      .populate("agentId", "name phone")
      .populate("lenderId", "name email");

    if (!group) {
      return res.status(404).json({ message: "No group found for this leader" });
    }

    const members = await GroupMember.find({ groupId: group._id })
      .populate("borrowerId", "fullName phone status");

    res.json({
      success: true,
      group,
      members
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   GET GROUP DETAILS
========================= */
exports.getGroupDetails = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findById(groupId)
      .populate("agentId", "name phone")
      .populate("lenderId", "name email");

    const members = await GroupMember.find({ groupId })
      .populate("borrowerId", "fullName phone");

    res.json({
      success: true,
      group,
      members
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   GET LENDER GROUPS
========================= */
exports.getLenderGroups = async (req, res) => {
  try {
    const lenderId = req.user._id;

    const groups = await Group.find({ lenderId });

    res.json({
      success: true,
      groups
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   GET PENDING GROUPS (FOR ADMIN/LENDER)
========================= */
exports.getPendingGroups = async (req, res) => {
  try {
    const query = { status: "pending" };

    // If lender is logged in → show only their pending groups
    // If admin is logged in → show all (overall)
    if (req.user.role === "lender") {
      query.lenderId = req.user._id;
    }

    const groups = await Group.find(query)
      .populate("agentId", "name phone")
      .populate("lenderId", "name email");

    res.json({
      success: true,
      count: groups.length,
      groups
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   APPROVE GROUP
========================= */
exports.approveGroup = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findByIdAndUpdate(
      groupId,
      { $set: { status: "active" } },
      { new: true }
    );

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    res.json({
      success: true,
      message: "Group approved and is now active",
      group
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   UPDATE GROUP
========================= */
exports.updateGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const updateData = req.body;

    const group = await Group.findByIdAndUpdate(
      groupId,
      { $set: updateData },
      { new: true }
    );

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    res.json({
      success: true,
      group
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   UPDATE GROUP STATUS
========================= */
exports.updateGroupStatus = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { status } = req.body;

    const validStatuses = ["active", "completed", "defaulted"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ 
        message: "Invalid status. Must be one of: active, completed, defaulted" 
      });
    }

    const group = await Group.findByIdAndUpdate(
      groupId,
      { $set: { status } },
      { new: true }
    );

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    res.json({
      success: true,
      group
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   DELETE GROUP
========================= */
exports.deleteGroup = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findByIdAndDelete(groupId);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    // Also remove all members
    await GroupMember.deleteMany({ groupId });

    res.json({
      success: true,
      message: "Group and its members deleted"
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   GET GROUP ANALYTICS
========================= */
exports.getGroupAnalytics = async (req, res) => {
  try {
    const lenderId = req.user._id;

    // 1. Basic group stats
    const totalGroups = await Group.countDocuments({ lenderId });
    
    // 2. Aggregate member stats per group
    const memberStats = await GroupMember.aggregate([
      {
        $lookup: {
          from: "groups",
          localField: "groupId",
          foreignField: "_id",
          as: "group"
        }
      },
      { $unwind: "$group" },
      { $match: { "group.lenderId": new mongoose.Types.ObjectId(lenderId) } },
      {
        $group: {
          _id: "$groupId",
          groupName: { $first: "$group.name" },
          memberCount: { $sum: 1 },
          totalFunding: { $first: "$group.total_funding" },
          totalRepaid: { $sum: "$total_repaid" },
          totalRemaining: { $sum: "$remaining_balance" }
        }
      },
      { $sort: { memberCount: -1 } }
    ]);

    const avgMembersPerGroup = totalGroups > 0 
      ? memberStats.reduce((sum, s) => sum + s.memberCount, 0) / totalGroups 
      : 0;

    const topGroupsByFunding = [...memberStats]
      .sort((a, b) => b.totalFunding - a.totalFunding)
      .slice(0, 5);

    const topGroupsByDebt = [...memberStats]
      .sort((a, b) => b.totalRemaining - a.totalRemaining)
      .slice(0, 5);

    res.json({
      success: true,
      summary: {
        totalGroups,
        avgMembersPerGroup: Number(avgMembersPerGroup.toFixed(1)),
        totalMembers: memberStats.reduce((sum, s) => sum + s.memberCount, 0)
      },
      performance: {
        topGroupsByFunding,
        topGroupsByDebt
      },
      memberDistribution: memberStats.map(s => ({
        groupName: s.groupName,
        count: s.memberCount,
        totalRepaid: s.totalRepaid,
        totalRemaining: s.totalRemaining
      }))
    });

  } catch (error) {
    console.error("Group analytics error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   DISBURSE GROUP LOAN
========================= */
exports.disburseGroupLoan = async (req, res) => {
  try {
    const { group_id, loan_amount, interest_rate, duration_months } = req.body;

    if (!group_id || !loan_amount) {
      return res.status(400).json({ message: "group_id and loan_amount are required" });
    }

    // 1️⃣ Find group
    const group = await Group.findById(group_id);
    if (!group) return res.status(404).json({ message: "Group not found" });

    // 2️⃣ Calculations (Example: 50,000 * 0.5% = 250 interest per month)
    const monthlyRate = interest_rate / 100; // Convert 0.5 to 0.005
    const monthlyInterest = loan_amount * monthlyRate;
    const totalInterest = monthlyInterest * duration_months;
    const totalRepayment = loan_amount + totalInterest;

    // Monthly payment to lender (Example: 53,000 / 12 = 4,416.67)
    const monthlyPayment = totalRepayment / duration_months;

    // 3️⃣ Update Group in DB
    group.loan_amount = loan_amount;
    group.interest_rate = interest_rate;
    group.duration_months = duration_months;
    group.total_interest = totalInterest;
    group.total_repayment = totalRepayment;
    group.remaining_loan_balance = totalRepayment;
    group.monthly_repayment_to_lender = Number(monthlyPayment.toFixed(2));
    group.status = "active"; // Ensure group is active

    await group.save();

    res.json({
      success: true,
      message: "Loan disbursed and group updated",
      data: {
        loan_amount: group.loan_amount,
        total_interest: group.total_interest,
        total_repayment: group.total_repayment,
        monthly_payment: group.monthly_repayment_to_lender
      }
    });

  } catch (error) {
    console.error("❌ disburseGroupLoan error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   REQUEST LOAN FOR GROUP MEMBER (BY LEADER)
========================= */
exports.requestGroupMemberLoan = async (req, res) => {
  try {
    const { groupId, borrowerId, leaderId, amount } = req.body;

    if (!groupId || !borrowerId || !leaderId || !amount) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // 1. Verify existence
    const GroupLoanRequest = require("../models/GroupLoanRequest");
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: "Group not found" });

    // 2. Data from Group
    const lenderId = group.lenderId;
    const agentId = group.agentId;

    // 3. Calculations
    const monthlyRate = (group.interest_rate || 0) / 100;
    const durationMonths = group.duration_months || 1;
    const totalDurationDays = durationMonths * 30;
    const totalInterest = amount * monthlyRate * durationMonths;
    const totalRepayment = amount + totalInterest;
    const dailyRepayment = totalRepayment / totalDurationDays;

    // 4. Agent Review Logic
    // If lender created group, agentReview is true.
    // If agent created group, agentReview is false (agent must review).
    const agentReview = group.createdByModel === "User";

    const loanRequest = await GroupLoanRequest.create({
      groupId,
      borrowerId,
      lenderId,
      agentId,
      requestedById: leaderId,
      amount,
      interest_rate: group.interest_rate,
      total_repayment: Math.ceil(totalRepayment),
      daily_repayment: Number(dailyRepayment.toFixed(2)),
      agentReview,
      agent_status: agentReview ? "approved" : "pending",
      status: "pending"
    });

    // 🔔 Push Notifications
    if (group.createdByModel === "Agent" && group.createdBy) {
      await Notification.create({
        userId: group.createdBy,
        userModel: "Agent",
        title: "New Loan Request (Review Required)",
        message: `A new loan request for ${group.name} is pending your review.`,
        type: "general",
      });
    } else if (group.createdByModel === "User" && group.lenderId) {
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
      message: agentReview ? "Loan request sent to lender" : "Loan request sent to agent for review",
      loanRequest
    });

  } catch (error) {
    console.error("❌ requestGroupMemberLoan error:", error);
    res.status(500).json({ message: error.message });
  }
};


/* =========================
   GET GROUP LOAN REQUESTS (LENDER / AGENT)
========================= */
exports.getGroupLoanRequests = async (req, res) => {
  try {
    const GroupLoanRequest = require("../models/GroupLoanRequest");
    const query = {};

    if (req.user.role === "lender") {
      query.lenderId = req.user._id;
      query.agentReview = true; // Lenders only see reviewed requests
    } else if (req.user.role === "agent") {
      query.agentId = req.user._id;
      // Agents see their own group requests (both reviewed and pending review)
    } else if (req.user.role === "admin") {
      // Admins see everything
    }

    const requests = await GroupLoanRequest.find(query)
      .populate("borrowerId", "fullName phone")
      .populate("groupId", "name")
      .populate("requestedById", "fullName phone")
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
   GET AGENT GROUPS (FOR LOGGED-IN AGENT)
========================= */
exports.getAgentGroups = async (req, res) => {
  try {
    const agentId = req.params.agentId || req.user._id;

    const groups = await Group.find({ agentId })
      .populate("group_leader_id", "fullName phone")
      .populate("lenderId", "name email");

    res.json({
      success: true,
      count: groups.length,
      groups
    });

  } catch (error) {
    console.error("❌ getAgentGroups error:", error);
    res.status(500).json({ message: error.message });
  }
};




/* =========================
   GET MY GROUP (FOR BORROWERS)
========================= */
/* =========================
   GET MY GROUP (FOR BORROWERS)
========================= */
exports.getMyGroup = async (req, res) => {
  try {
    const borrowerId = req.borrower._id;

    // 1. Find if this borrower is a member of any group
    const membership = await GroupMember.findOne({ borrowerId });
    if (!membership) {
      return res.status(200).json({ success: false, message: "You are not a member of any group" });
    }

    const groupId = membership.groupId;

    // 2. Fetch full group details
    const group = await Group.findById(groupId)
      .populate("agentId", "name phone")
      .populate("lenderId", "name email")
      .populate("group_leader_id", "fullName phone");

    if (!group) {
      return res.status(404).json({ success: false, message: "Group not found" });
    }

    // 3. Fetch all members of this group
    const members = await GroupMember.find({ groupId })
      .populate("borrowerId", "fullName phone status");

    // 4. Check if current user is the leader
    const isLeader = group.group_leader_id && group.group_leader_id._id.toString() === borrowerId.toString();

    res.json({
      success: true,
      isLeader,
      group,
      members,
      myMembership: membership
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


/* =========================
   GET GROUP REPAYMENTS
========================= */
exports.getGroupRepayments = async (req, res) => {
  try {
    const { groupId } = req.params;
    const Transaction = require("../models/Transaction");

    const repayments = await Transaction.find({
      groupId,
      type: "group member repayment",
      status: "successful"
    })
    .populate("userId", "fullName phone")
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: repayments.length,
      repayments
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   GET GROUP MONTHLY REPAYMENTS (HISTORY/AGGREGATED)
========================= */
exports.getGroupMonthlyPayments = async (req, res) => {
  try {
    const { groupId } = req.params;
    const GroupMonthlyPayment = require("../models/groupMonthlyPaymentModel");

    const repayments = await GroupMonthlyPayment.find({ group_id: groupId })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: repayments.length,
      repayments
    });

  } catch (error) {
    console.error("❌ getGroupMonthlyPayments error:", error);
    res.status(500).json({ message: error.message });
  }
};