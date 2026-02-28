const Group = require("../models/Group");
const GroupMember = require("../models/GroupMember");
const Customer = require("../models/customer");
const { sendSMS } = require("../utils/sms");

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

    if (!groupId || !borrowerId) {
      return res.status(400).json({ message: "groupId and borrowerId are required" });
    }

    // Support single ID or array of IDs
    const ids = Array.isArray(borrowerId) ? borrowerId : [borrowerId];

    // Find all valid customers
    const customers = await Customer.find({ _id: { $in: ids } });
    const validIds = customers.map(c => c._id.toString());

    if (validIds.length === 0) {
      return res.status(404).json({ message: "No valid borrowers found" });
    }

    // Find existing group members
    const existingMembers = await GroupMember.find({
      groupId,
      borrowerId: { $in: validIds }
    }).select("borrowerId");

    const existingIds = existingMembers.map(m => m.borrowerId.toString());

    // Filter IDs that are not already members
    const newMemberIds = validIds.filter(id => !existingIds.includes(id));

    if (newMemberIds.length === 0) {
      return res.status(400).json({ message: "All borrowers are already in the group" });
    }

    // Create new group members in bulk
    const newMembers = newMemberIds.map(id => ({ groupId, borrowerId: id }));
    const addedMembers = await GroupMember.insertMany(newMembers);

    res.json({
      success: true,
      addedMembers,
      skipped: existingIds
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}
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
