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
      return res.status(400).json({
        message: "groupId and borrowerId are required"
      });
    }

    // Normalize to array
    const borrowerIds = Array.isArray(borrowerId)
      ? borrowerId
      : [borrowerId];

    // Validate borrowers
    const borrowers = await Customer.find({
      _id: { $in: borrowerIds }
    });

    if (!borrowers.length) {
      return res.status(404).json({
        message: "No valid borrowers found"
      });
    }

    const validIds = borrowers.map(b => b._id.toString());

    // Check existing members
    const existingMembers = await GroupMember.find({
      groupId,
      borrowerId: { $in: validIds }
    }).select("borrowerId");

    const existingIds = existingMembers.map(m =>
      m.borrowerId.toString()
    );

    // Filter new IDs
    const newIds = validIds.filter(
      id => !existingIds.includes(id)
    );

    if (!newIds.length) {
      return res.status(400).json({
        message: "All borrowers already exist in this group"
      });
    }

    // Bulk create
    const membersToCreate = newIds.map(id => ({
      groupId,
      borrowerId: id
    }));

    const createdMembers = await GroupMember.insertMany(
      membersToCreate
    );

    /* ===============================
       SEND SMS TO EACH NEW MEMBER
    =============================== */

    const group = await Group.findById(groupId)
      .populate("lenderId", "name");

    const groupMembers = await GroupMember.find({ groupId })
      .populate("borrowerId", "fullName")
      .limit(10);

    const memberNames = groupMembers
      .filter(m => m.borrowerId)
      .map(m =>
        m.borrowerId.fullName?.split(" ")[0]
      )
      .join(", ");

    const adminName = group?.lenderId?.name || "Group Admin";

    // Send SMS one by one
    for (const borrower of borrowers) {
      if (newIds.includes(borrower._id.toString())) {
        const message = `You have been added to the ${group.name} Group.

Admin: ${adminName}
Total Members: ${groupMembers.length}
Members: ${memberNames}`;

        await sendSMS(borrower.phone, message);
      }
    }

    res.json({
      success: true,
      addedCount: createdMembers.length,
      addedMembers: createdMembers,
      skipped: existingIds
    });

  } catch (error) {

    if (error.code === 11000) {
      return res.status(400).json({
        message: "Customer already exists in this group"
      });
    }

    console.error("❌ addMember error:", error);
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
          totalContribution: { $first: "$group.totalContribution" },
          totalOwed: { $first: "$group.totalOwed" }
        }
      },
      { $sort: { memberCount: -1 } }
    ]);

    const avgMembersPerGroup = totalGroups > 0 
      ? memberStats.reduce((sum, s) => sum + s.memberCount, 0) / totalGroups 
      : 0;

    const topGroupsByContribution = [...memberStats]
      .sort((a, b) => b.totalContribution - a.totalContribution)
      .slice(0, 5);

    const topGroupsByDebt = [...memberStats]
      .sort((a, b) => b.totalOwed - a.totalOwed)
      .slice(0, 5);

    res.json({
      success: true,
      summary: {
        totalGroups,
        avgMembersPerGroup: Number(avgMembersPerGroup.toFixed(1)),
        totalMembers: memberStats.reduce((sum, s) => sum + s.memberCount, 0)
      },
      performance: {
        topGroupsByContribution,
        topGroupsByDebt
      },
      memberDistribution: memberStats.map(s => ({
        groupName: s.groupName,
        count: s.memberCount
      }))
    });

  } catch (error) {
    console.error("Group analytics error:", error);
    res.status(500).json({ message: error.message });
  }
};
