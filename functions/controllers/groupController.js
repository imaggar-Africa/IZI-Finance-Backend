const Group = require("../models/Group");
const GroupMember = require("../models/GroupMember");
const Customer = require("../models/customer");

/* =========================
   CREATE GROUP
========================= */
exports.createGroup = async (req, res) => {
  try {
    const lenderId = req.user._id;
    const { name, description, creditLimit } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Group name required" });
    }

    const group = await Group.create({
      name,
      description,
      lenderId,
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
   ADD BORROWER TO GROUP
========================= */
exports.addMember = async (req, res) => {
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
   REMOVE MEMBER
========================= */
exports.removeMember = async (req, res) => {
  try {
    const { groupId, borrowerId } = req.body;

    await GroupMember.deleteOne({ groupId, borrowerId });

    res.json({
      success: true,
      message: "Member removed"
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
      .populate("leaderId", "fullName");

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
