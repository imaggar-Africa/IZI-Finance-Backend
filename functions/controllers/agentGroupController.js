const Group = require("../models/Group");
const GroupMember = require("../models/GroupMember");
const Customer = require("../models/customer");

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

    const group = await Group.create({
      name,
      description,
      agentId,
      leaderId,
      creditLimit
    });

    res.status(201).json({
      success: true,
      group
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =========================
   ADD MEMBER (AGENT)
========================= */
exports.addMemberByAgent = async (req, res) => {
  try {
    const { groupId, borrowerId } = req.body;

    const borrower = await Customer.findById(borrowerId);
    if (!borrower) {
      return res.status(404).json({ message: "Borrower not found" });
    }

    const exists = await GroupMember.findOne({ groupId, borrowerId });
    if (exists) {
      return res.status(400).json({ message: "Borrower already in group" });
    }

    const member = await GroupMember.create({
      groupId,
      borrowerId
    });

    res.json({
      success: true,
      member
    });

  } catch (error) {
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
