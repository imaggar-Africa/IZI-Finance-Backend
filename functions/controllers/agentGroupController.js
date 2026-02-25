const AgentModel = require("../models/AgentModel");
const Group = require("../models/Group");
const GroupMember = require("../models/GroupMember");
const Notification = require("../models/Notification");
const Customer = require("../models/customer");
const { sendSMS } = require("../utils/sms");

/* =========================
   CREATE GROUP (AGENT)
========================= */
exports.createAgentGroup = async (req, res) => {
  try {
    const agentId = req.user._id;
    const { name, description, creditLimit, leaderId } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Group name required" });
    }

    // 🔹 Get agent (to find lender)
    const agent = await AgentModel.findById(agentId);
    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }

    // 🔹 Create group
    const group = await Group.create({
      name,
      description,
      agentId,
      leaderId,
      creditLimit,
      lenderId: agent.lenderId   // ✅ IMPORTANT
    });

    /* ===============================
       CREATE NOTIFICATION FOR LENDER
    =============================== */

    await Notification.create({
      userId: agent.lenderId,
      userModel: "User", // lender is User
      title: "New Group Created",
      message: `Agent ${agent.name} created a new group "${group.name}".`,
      type: "general"
    });

    res.status(201).json({
      success: true,
      group
    });

  } catch (error) {
    console.error("❌ createAgentGroup error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   ADD MEMBER (AGENT)
========================= */
exports.addMemberByAgent = async (req, res) => {
  try {
    const { groupId, borrowerId } = req.body;

    /* ===============================
       1️⃣ VALIDATE BORROWER
    =============================== */
    const borrower = await Customer.findById(borrowerId);
    if (!borrower) {
      return res.status(404).json({ message: "Borrower not found" });
    }

    /* ===============================
       2️⃣ PREVENT DUPLICATE
    =============================== */
    const exists = await GroupMember.findOne({ groupId, borrowerId });
    if (exists) {
      return res.status(400).json({
        message: "Customer already exists in this group"
      });
    }

    /* ===============================
       3️⃣ ADD MEMBER
    =============================== */
    const member = await GroupMember.create({ groupId, borrowerId });

    /* ===============================
       4️⃣ SEND SMS AFTER ADD
    =============================== */
    const group = await Group.findById(groupId)
      .populate("lenderId", "name");

    const members = await GroupMember.find({ groupId })
      .populate("borrowerId", "fullName")
      .limit(10);

    const memberNames = members
      .filter(m => m.borrowerId)
      .map(m => m.borrowerId.fullName?.split(" ")[0])
      .join(", ");

    const adminName = group?.lenderId?.name || "Group Admin";

    const message = `You have been added to the ${group.name} Group.

Admin: ${adminName}
Total Members: ${members.length}
Members: ${memberNames}`;

    await sendSMS(borrower.phone, message);

    /* ===============================
       5️⃣ RESPONSE
    =============================== */
    res.json({
      success: true,
      member
    });

  } catch (error) {
    // ✅ Handle DB duplicate safely
    if (error.code === 11000) {
      return res.status(400).json({
        message: "Customer already exists in this group"
      });
    }

    console.error("❌ addMemberByAgent error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   REMOVE MEMBER (AGENT)
========================= */
exports.removeMemberByAgent = async (req, res) => {
  try {
    const agentId = req.user._id;
    const { groupId, borrowerId } = req.body;

    if (!groupId || !borrowerId) {
      return res.status(400).json({
        message: "groupId and borrowerId are required"
      });
    }

    // Check group belongs to agent
    const group = await require("../models/Group").findOne({
      _id: groupId,
      agentId
    });

    if (!group) {
      return res.status(403).json({
        message: "Unauthorized or group not found"
      });
    }

    // Check member exists
    const GroupMember = require("../models/GroupMember");

    const member = await GroupMember.findOne({ groupId, borrowerId });

    if (!member) {
      return res.status(404).json({
        message: "Member not found in this group"
      });
    }

    // Optional Safety Check (if borrower has active loan → block removal)
    const Loan = require("../models/Loan");

    const activeLoan = await Loan.findOne({
      borrowerId,
      status: { $in: ["active", "overdue"] }
    });

    if (activeLoan) {
      return res.status(400).json({
        message: "Cannot remove borrower with active loan"
      });
    }

    await member.deleteOne();

    return res.json({
      success: true,
      message: "Member removed successfully"
    });

  } catch (error) {
    console.error("removeMemberByAgent error:", error);
    res.status(500).json({ message: error.message });
  }
};


/* =========================
   GET AGENT GROUPS
========================= */
exports.getAgentGroups = async (req, res) => {
  try {
    const agentId = req.user._id;

    const groups = await Group.find({ agentId })
      .populate("leaderId", "fullName");

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
   GET AGENT GROUP DETAILS
========================= */
exports.getAgentGroupDetails = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findById(groupId)
      .populate("leaderId", "fullName");

    const members = await GroupMember.find({ groupId })
      .populate("borrowerId", "fullName phone");

    res.json({
      success: true,
      group: {
        _id: group._id,
        name: group.name,
        creditLimit: group.creditLimit,
        leader: group.leaderId
      },
      members: members.map(m => ({
        borrowerId: m.borrowerId._id,
        name: m.borrowerId.fullName,
        phone: m.borrowerId.phone
      }))
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
