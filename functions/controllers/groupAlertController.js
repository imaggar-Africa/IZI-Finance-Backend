const GroupMember = require("../models/GroupMember");
const Group = require("../models/Group");
const GroupAlert = require("../models/groupAlertModel");
const Borrower = require("../models/customer");
const { sendSMS } = require("../utils/sms");
const { sendPushToUser } = require("../utils/expoPush");

/**
 * Runs daily to check for missed repayments.
 * Logic:
 * 1. Find all active members.
 * 2. If no payment received today (or last_repayment_date is before today).
 * 3. Increment consecutive_missed_days.
 * 4. Create GroupAlert.
 * 5. Send alerts to Member and Group Leader.
 * 6. If days >= 3, escalate and change status to 'delayed'.
 */
exports.checkMissedRepayments = async (req, res) => {
  try {
    console.log("🕒 Starting daily missed repayment check...");
    
    // Get date for start of today
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // 1. Find all active group members with an active loan
    const members = await GroupMember.find({ 
      status: { $in: ["active", "delayed"] },
      remaining_balance: { $gt: 0 }
    }).populate("groupId");

    const alertsCreated = [];

    for (const member of members) {
      const lastPaid = member.last_repayment_date ? new Date(member.last_repayment_date) : null;
      
      // If last repayment was before today (or never)
      if (!lastPaid || lastPaid < startOfToday) {
        member.consecutive_missed_days = (member.consecutive_missed_days || 0) + 1;
        
        let alertType = "missed_payment";
        let shouldEscalate = false;
        
        if (member.consecutive_missed_days >= 3) {
          member.status = "delayed";
          alertType = "member_3day";
          shouldEscalate = true;
        }

        await member.save();

        const borrower = await Borrower.findById(member.borrowerId);
        const group = member.groupId;
        const leader = group?.group_leader_id ? await Borrower.findById(group.group_leader_id) : null;

        // 2. Create Official Alert Record
        const alert = await GroupAlert.create({
          group_id: group?._id,
          member_id: member.borrowerId,
          alert_type: alertType,
          message: `Member ${borrower?.fullName} missed his daily repayment of KES ${member.daily_repayment_amount}. (Consecutive days: ${member.consecutive_missed_days})`,
          status: shouldEscalate ? "escalated" : "open"
        });
        console.log(`📝 Alert Created: [${alertType}] for ${borrower?.fullName} in group ${group?.name}. Status: ${alert.status}`);

        // 3. Send SMS Notifications
        if (borrower) {
          await sendSMS(
            borrower.phone,
            `Reminder: Your daily repayment of KES ${member.daily_repayment_amount} for ${group?.name || "your group"} is pending. Please pay today to avoid penalties. - IziFinance`
          );
          console.log(`📩 SMS Sent to Member: ${borrower?.fullName} (${borrower.phone})`);
          
          await sendPushToUser(borrower._id, "Customer", "Missed Payment Reminder", `Your daily repayment for ${group?.name} is due.`);
          console.log(`🔔 Push Notification Sent to Member: ${borrower?.fullName}`);
        }

        if (leader && leader.phone) {
          await sendSMS(
            leader.phone,
            `Notice: ${borrower?.fullName} missed today's repayment for ${group?.name}. Please follow up. - IziFinance`
          );
          console.log(`📩 SMS Sent to Group Leader: ${leader?.fullName} about missed payment by ${borrower?.fullName}`);
        }

        alertsCreated.push({
          member: borrower?.fullName,
          group: group?.name,
          missedDays: member.consecutive_missed_days,
          escalated: shouldEscalate
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Missed repayment check completed. ${alertsCreated.length} alerts generated.`,
      alerts: alertsCreated
    });

  } catch (error) {
    console.error("❌ Error in checkMissedRepayments:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Runs daily at 11:59 PM to check group pool health.
 * Logic:
 * 1. Compare 'collected_pool_balance' with 'expected accrual' (based on day of month).
 * 2. If pool < 80% of expected progress -> alert agent & leader.
 */
exports.checkGroupHealth = async (req, res) => {
  try {
    console.log("🕒 Starting daily group health (pool) check...");
    
    // Calculate expected progress based on day of month (1-30)
    const now = new Date();
    const dayOfMonth = now.getDate();
    // Use 30 as standard month length for finance calculations
    const monthProgressDecimal = dayOfMonth / 30;

    const groups = await Group.find({ status: "active" });
    const healthAlerts = [];

    for (const group of groups) {
      const monthlyGoal = group.monthly_repayment_to_lender || 0;
      if (monthlyGoal === 0) continue;

      const expectedSoFar = monthlyGoal * monthProgressDecimal;
      const actualPool = group.collected_pool_balance || 0;

      // 80% threshold of the prorated monthly goal
      const healthThreshold = expectedSoFar * 0.8;

      if (actualPool < healthThreshold) {
        // Unhealthy collection
        const message = `Health Alert: ${group.name} pool is at KES ${actualPool.toFixed(2)}, which is below the 80% threshold of prorated goal (Target: KES ${expectedSoFar.toFixed(2)}).`;
        
        // 1. Create Alert Record
        const alert = await GroupAlert.create({
          group_id: group._id,
          alert_type: "group_shortfall",
          message: message,
          status: "open"
        });
        console.log(`📝 Health Alert Created: [group_shortfall] for ${group.name}. Pool: KES ${actualPool}. Target: KES ${expectedSoFar}`);

        // 2. Notify Leader & Agent via SMS
        const leader = group.group_leader_id ? await Borrower.findById(group.group_leader_id) : null;
        const agent = group.agentId ? await require("../models/AgentModel").findById(group.agentId) : null;

        if (leader) {
          const leaderMsg = `Health Alert: Your group ${group.name} is behind on daily collections. Current total: KES ${actualPool}. Please encourage members to pay. - IziFinance`;
          await sendSMS(leader.phone, leaderMsg, {
            job: "group-health",
            template: "group_health_leader",
            meta: { groupId: String(group._id), groupName: group.name, pool: actualPool },
          });
          console.log(`📩 SMS Sent to Leader: ${leader?.fullName} about poor group health for ${group.name}`);
        }

        if (agent) {
          const agentMsg = `Agent Alert: Group ${group.name} collection health is POOR (< 80% of target). Current Pool: KES ${actualPool}. Immediate follow up required. - IziFinance`;
          await sendSMS(agent.phone, agentMsg, {
            job: "group-health",
            template: "group_health_agent",
            meta: { groupId: String(group._id), groupName: group.name, pool: actualPool },
          });
          console.log(`📩 SMS Sent to Agent: (${agent.phone}) for group ${group.name}`);
        }

        healthAlerts.push({ group: group.name, pool: actualPool, target: expectedSoFar });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Group health check completed. ${healthAlerts.length} issues detected.`,
      issues: healthAlerts
    });

  } catch (error) {
    console.error("❌ Error in checkGroupHealth:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET ALL ALERTS FOR A GROUP
 */
exports.getGroupAlerts = async (req, res) => {
  try {
    const alerts = await GroupAlert.find({ group_id: req.params.group_id })
      .populate("member_id", "fullName phone")
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, alerts });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * RESOLVE AN ALERT (Status -> resolved)
 */
exports.resolveAlert = async (req, res) => {
  try {
    const alert = await GroupAlert.findById(req.params.alert_id);
    if (!alert) return res.status(404).json({ message: "Alert not found" });

    alert.status = "resolved";
    alert.resolved_at = new Date();
    await alert.save();

    return res.status(200).json({ success: true, message: "Alert resolved", alert });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * ESCALATE AN ALERT (Status -> escalated)
 */
exports.escalateAlert = async (req, res) => {
  try {
    const alert = await GroupAlert.findById(req.params.alert_id);
    if (!alert) return res.status(404).json({ message: "Alert not found" });

    alert.status = "escalated";
    await alert.save();

    return res.status(200).json({ success: true, message: "Alert escalated", alert });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};
