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
    const { name, description, lenderId, agentId, group_leader_id, location } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Group name required" });
    }

    /* ===============================
       1️⃣ PREPARE GROUP DATA
    =============================== */

    // If an Agent creates → set agentId from req.user
    // If a Lender creates → set lenderId from req.user

    let finalLenderId = lenderId;
    let finalAgentId = agentId;

    if (req.user.role === "agent") {
      finalAgentId = req.user._id;
      // Also get lenderId from agent's own data
      const agent = await AgentModel.findById(finalAgentId);
      if (agent) finalLenderId = agent.lenderId;
    } else if (req.user.role === "lender" || req.user.role === "admin") {
      finalLenderId = req.user._id;
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
      status: "pending",
    });


    /* ===============================
       2️⃣ NOTIFICATION
    ============================== */

    if (finalAgentId && finalLenderId) {
      // Notify Lender
      await Notification.create({
        userId: finalLenderId,
        userModel: "User",
        title: "New Group Created",
        message: `Agent created a new group "${group.name}".`,
        type: "general",
      });

      // Notify Agent
      await Notification.create({
        userId: finalAgentId,
        userModel: "Agent",
        title: "Group Created Successfully",
        message: `You created a new group "${group.name}".`,
        type: "general",
      });
    }


    res.status(201).json({
      success: true,
      group,
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

    if (!groupId || !borrowerId) {
      return res
        .status(400)
        .json({ message: "groupId and borrowerId are required" });
    }

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

      const exists = await GroupMember.findOne({ groupId, borrowerId: id });
      if (exists) {
        skippedBorrowers.push(borrower.fullName);
        continue;
      }

      const member = await GroupMember.create({
        groupId,
        borrowerId: id,
        internal_loan_amount: null,
        daily_repayment_amount: null,
        total_repaid: 0,
        remaining_balance: null,
        status: "active",
      });

      addedMembers.push(member);

      const group = await Group.findById(groupId).populate("lenderId", "name");

      const members = await GroupMember.find({ groupId })
        .populate("borrowerId", "fullName")
        .limit(10);

      const memberNames = members
        .filter((m) => m.borrowerId)
        .map((m) => m.borrowerId.fullName?.split(" ")[0])
        .join(", ");

      const adminName = group?.lenderId?.name || "Group Admin";

      const message = `You have been added to the ${group.name} Group.

Admin: ${adminName}
Total Members: ${members.length}
Members: ${memberNames}`;

      await sendSMS(borrower.phone, message);

      // 🔔 Push Notification for Member
      await Notification.create({
        userId: borrower._id,
        userModel: "Customer",
        title: "Added to Group",
        message: `You have been added to the ${group.name} Group.`,
        type: "general",
      });
      console.log(
        `🔔 Push Notification Sent to Member: ${borrower.fullName} for group addition`,
      );

      // 🔔 Push Notification for Lender (since Agent added a member)
      if (group.lenderId) {
        await Notification.create({
          userId: group.lenderId._id || group.lenderId,
          userModel: "User",
          title: "Member Added to Group",
          message: `Agent added ${borrower.fullName} to the group "${group.name}".`,
          type: "general",
        });
      }
    }


    if (addedMembers.length > 0) {
      await Group.findByIdAndUpdate(groupId, {
        $inc: { member_count: addedMembers.length },
      });
    }

    /* ===============================
       5️⃣ RESPONSE
    =============================== */
    res.json({
      success: true,
      count: addedMembers.length,
      members: addedMembers,
      skipped: skippedBorrowers,
    });
  } catch (error) {
    // ✅ Handle DB duplicate safely
    if (error.code === 11000) {
      return res.status(400).json({
        message: "Customer already exists in this group",
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
        message: "groupId and borrowerId are required",
      });
    }

    // Check group belongs to agent
    const group = await require("../models/Group").findOne({
      _id: groupId,
      agentId,
    });

    if (!group) {
      return res.status(403).json({
        message: "Unauthorized or group not found",
      });
    }

    // Check member exists
    const GroupMember = require("../models/GroupMember");

    const member = await GroupMember.findOne({ groupId, borrowerId });

    if (!member) {
      return res.status(404).json({
        message: "Member not found in this group",
      });
    }

    // Optional Safety Check (if borrower has active loan → block removal)
    const Loan = require("../models/Loan");

    const activeLoan = await Loan.findOne({
      borrowerId,
      status: { $in: ["active", "overdue"] },
    });

    if (activeLoan) {
      return res.status(400).json({
        message: "Cannot remove borrower with active loan",
      });
    }

    await member.deleteOne();

    await Group.findByIdAndUpdate(groupId, {
      $inc: { member_count: -1 },
    });

    // 🔔 Push Notification for Member
    await Notification.create({
      userId: borrowerId,
      userModel: "Customer",
      title: "Removed from Group",
      message: `You have been removed from the ${group.name} Group.`,
      type: "general",
    });

    return res.json({
      success: true,
      message: "Member removed successfully",
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

    const groups = await Group.find({ agentId }).populate(
      "group_leader_id",
      "fullName",
    );

    res.json({
      success: true,
      count: groups.length,
      groups,
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

    const group = await Group.findById(groupId).populate(
      "group_leader_id",
      "fullName",
    );

    const members = await GroupMember.find({ groupId }).populate(
      "borrowerId",
      "fullName phone",
    );

    res.json({
      success: true,
      group: {
        _id: group._id,
        name: group.name,
        creditLimit: group.creditLimit,
        leader: group.group_leader_id,
      },
      members: members.map((m) => ({
        borrowerId: m.borrowerId._id,
        name: m.borrowerId.fullName,
        phone: m.borrowerId.phone,
      })),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};