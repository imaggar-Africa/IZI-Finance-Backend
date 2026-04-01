const Transaction = require("../models/Transaction");
const Group = require("../models/Group");
const GroupMember = require("../models/GroupMember");
const GroupLoanRequest = require("../models/GroupLoanRequest");
const mongoose = require("mongoose");

/**
 * 📊 GET WEEKLY GROUP LOAN REPORT (Last 7 Days)
 */
exports.getWeeklyGroupReport = async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // 💰 Disbursements (issued in last 7 days)
    const disbursements = await Transaction.aggregate([
      { $match: { 
          type: "group loan issued", 
          status: "successful", 
          createdAt: { $gte: sevenDaysAgo } 
        } 
      },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    // 💸 Repayments Summary
    const repayments = await Transaction.aggregate([
      { $match: { 
          type: "group member repayment", 
          status: "successful", 
          createdAt: { $gte: sevenDaysAgo } 
        } 
      },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    // 💸 Repayments Details
    const repaymentList = await Transaction.find({ 
      type: "group member repayment", 
      status: "successful", 
      createdAt: { $gte: sevenDaysAgo } 
    }).populate("userId", "fullName phone")
      .populate("groupId", "name")
      .select("-checkoutRequestID -merchantRequestID -mpesaResponse -mpesaRawResponse")
      .sort({ createdAt: -1 });

    // 💰 Disbursement Details
    const disbursementList = await Transaction.find({ 
      type: "group loan issued", 
      status: "successful", 
      createdAt: { $gte: sevenDaysAgo } 
    }).populate("userId", "fullName phone")
      .populate("groupId", "name")
      .select("-checkoutRequestID -merchantRequestID -mpesaResponse -mpesaRawResponse")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      period: "Weekly (Last 7 Days)",
      summary: {
        totalDisbursed: disbursements[0]?.total || 0,
        totalRepaid: repayments[0]?.total || 0,
        disbursementCount: disbursements[0]?.count || 0,
        repaymentCount: repayments[0]?.count || 0
      },
      details: {
        disbursements: disbursementList,
        repayments: repaymentList
      }
    });

  } catch (error) {
    console.error("❌ getWeeklyGroupReport error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * 📊 GET MONTHLY GROUP LOAN REPORT (Last 30 Days)
 */
exports.getMonthlyGroupReport = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const disbursements = await Transaction.aggregate([
      { $match: { 
          type: "group loan issued", 
          status: "successful", 
          createdAt: { $gte: thirtyDaysAgo } 
        } 
      },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    const repayments = await Transaction.aggregate([
      { $match: { 
          type: "group member repayment", 
          status: "successful", 
          createdAt: { $gte: thirtyDaysAgo } 
        } 
      },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    // 💸 Repayments Details
    const repaymentList = await Transaction.find({ 
      type: "group member repayment", 
      status: "successful", 
      createdAt: { $gte: thirtyDaysAgo } 
    }).populate("userId", "fullName phone")
      .populate("groupId", "name")
      .select("-checkoutRequestID -merchantRequestID -mpesaResponse -mpesaRawResponse")
      .sort({ createdAt: -1 });

    // 💰 Disbursement Details
    const disbursementList = await Transaction.find({ 
      type: "group loan issued", 
      status: "successful", 
      createdAt: { $gte: thirtyDaysAgo } 
    }).populate("userId", "fullName phone")
      .populate("groupId", "name")
      .select("-checkoutRequestID -merchantRequestID -mpesaResponse -mpesaRawResponse")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      period: "Monthly (Last 30 Days)",
      summary: {
        totalDisbursed: disbursements[0]?.total || 0,
        totalRepaid: repayments[0]?.total || 0,
        disbursementCount: disbursements[0]?.count || 0,
        repaymentCount: repayments[0]?.count || 0
      },
      details: {
        disbursements: disbursementList,
        repayments: repaymentList
      }
    });

  } catch (error) {
    console.error("❌ getMonthlyGroupReport error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * 📊 GET GROUP LOAN REPORT BY AGENT ID
 * Returns summary stats for a specific agent's groups
 */
exports.getAgentGroupReport = async (req, res) => {
  try {
    const { agentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(agentId)) {
      return res.status(400).json({ message: "Invalid Agent ID" });
    }

    // 1️⃣ Find all groups managed by this agent
    const groups = await Group.find({ agentId });
    const groupIds = groups.map(g => g._id);

    // 2️⃣ Aggregate Disbursements for these specific groups
    const disbursements = await Transaction.aggregate([
      { $match: { 
          type: "group loan issued", 
          status: "successful", 
          groupId: { $in: groupIds } 
        } 
      },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    // 3️⃣ Aggregate Repayments for these specific groups
    const repayments = await Transaction.aggregate([
      { $match: { 
          type: "group member repayment", 
          status: "successful", 
          groupId: { $in: groupIds } 
        } 
      },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    // 💸 Repayments Details Listing
    const repaymentList = await Transaction.find({ 
      type: "group member repayment", 
      status: "successful", 
      groupId: { $in: groupIds } 
    }).populate("userId", "fullName phone")
      .populate("groupId", "name")
      .select("-checkoutRequestID -merchantRequestID -mpesaResponse -mpesaRawResponse")
      .sort({ createdAt: -1 });

    // 💰 Disbursement Details Listing
    const disbursementList = await Transaction.find({ 
      type: "group loan issued", 
      status: "successful", 
      groupId: { $in: groupIds } 
    }).populate("userId", "fullName phone")
      .populate("groupId", "name")
      .select("-checkoutRequestID -merchantRequestID -mpesaResponse -mpesaRawResponse")
      .sort({ createdAt: -1 });

    // 4️⃣ Group Members Details (Detailed View)
    const members = await GroupMember.find({ groupId: { $in: groupIds } })
      .populate("borrowerId", "fullName phone idNumber")
      .populate("groupId", "name");

    const totalMembersCount = groups.reduce((sum, g) => sum + (g.member_count || 0), 0);

    res.status(200).json({
      success: true,
      agentId,
      summary: {
        totalGroups: groups.length,
        activeGroups: groups.filter(g => g.status === "active").length,
        totalMembersCount,
        totalLifeTimeDisbursed: disbursements[0]?.total || 0,
        totalLifeTimeRepaid: repayments[0]?.total || 0,
        outstandingBalance: (disbursements[0]?.total || 0) - (repayments[0]?.total || 0),
        disbursementCount: disbursements[0]?.count || 0,
        repaymentCount: repayments[0]?.count || 0
      },
      details: {
        groups: groups,
        members: members,
        disbursements: disbursementList,
        repayments: repaymentList
      }
    });

  } catch (error) {
    console.error("❌ getAgentGroupReport error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};
