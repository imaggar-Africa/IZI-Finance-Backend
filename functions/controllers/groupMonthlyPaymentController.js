const Group = require("../models/Group");
const GroupMonthlyPayment = require("../models/groupMonthlyPaymentModel");
const User = require("../models/User");
const AgentModel = require("../models/AgentModel");
const Customer = require("../models/customer");
const Transaction = require("../models/Transaction");
const { sendSMS } = require("../utils/sms");
const { initiateB2C } = require("../utils/mpesa");
const Notification = require("../models/Notification");
const mongoose = require("mongoose");

/**
 * 📅 PROCESS MONTHLY REPAYMENTS FOR ALL ACTIVE GROUPS
 * This function should be called on the 1st of every month via cron job or admin endpoint.
 */
exports.processMonthlyGroupRepayments = async (req, res) => {
  try {
    const groups = await Group.find({ status: "active" })
      .populate("lenderId")
      .populate("agentId")
      .populate("group_leader_id");

    const processingResults = [];
    
    // Default to the previous month (since we typically pay on the 1st of the next month)
    const now = new Date();
    let month = req.body.month || (now.getMonth() === 0 ? 12 : now.getMonth());
    let year = req.body.year || (now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());

    for (const group of groups) {
      try {
        const expectedAmount = group.monthly_repayment_to_lender || 0;
        const actualPoolAmount = group.collected_pool_balance || 0;
        const shortfall = Math.max(0, expectedAmount - actualPoolAmount);
        
        let status = "paid";
        if (shortfall > 0) {
          status = "shortfall";
        }

        // 1️⃣ Record the payment in GroupMonthlyPayment
        const monthlyPayment = await GroupMonthlyPayment.create({
          group_id: group._id,
          expected_amount: expectedAmount,
          actual_amount: actualPoolAmount,
          shortfall: shortfall,
          month: month,
          year: year,
          payment_date: new Date(),
          status: status
        });

        // 2️⃣ Transfer pool amount to Lender's wallet (This mimics SHOFCO receiving the payment)
        // Note: SHOFCO is essentially the lender in this scenario
        // 2️⃣ Transfer pool amount to Lender's account (via M-Pesa B2C)
        if (group.lenderId && actualPoolAmount > 0) {
          const lender = group.lenderId; // Populated User
          const phone = lender.phone;

          // 🏦 Create Pending Transaction Record for Lender
          const transaction = await Transaction.create({
            userId: lender._id,
            userModel: "User",
            type: "monthly group repayment",
            amount: actualPoolAmount,
            groupId: group._id,
            status: "pending",
            phone: phone,
            description: `Monthly aggregate repayment for group: ${group.name}`
          });

          // Link transaction ID
          monthlyPayment.transaction_id = transaction._id;
          await monthlyPayment.save();

          // 💸 Initiate B2C Transfer from IziFinance Paybill to Lender M-Pesa
          if (phone) {
            try {
              const b2cResponse = await initiateB2C(phone, actualPoolAmount, transaction._id);
              if (b2cResponse?.OriginatorConversationID) {
                transaction.checkoutRequestID = b2cResponse.OriginatorConversationID;
                await transaction.save();
                console.log(`✅ B2C initiated for ${lender.name}: ${actualPoolAmount}`);
              }
            } catch (b2cError) {
              console.error(`❌ B2C initiation failed for group ${group.name}:`, b2cError);
              transaction.status = "failed";
              transaction.failureReason = "B2C initiation failed: " + b2cError.message;
              await transaction.save();
            }
          }
        }

        // 4️⃣ Send Alerts if there's a shortfall
        if (shortfall > 0) {
          // Alert Group Leader
          if (group.group_leader_id && group.group_leader_id.phone) {
            await sendSMS(
              group.group_leader_id.phone,
              `IZIFINANCE: ${group.name} shortfall of KES ${shortfall.toFixed(2)} this month. Please follow up with members who missed payments.`
            );
            console.log(`📩 Monthly Shortfall SMS Sent to Leader: ${group.group_leader_id.name || 'Leader'} for group ${group.name}`);
          }

          // Alert Agent
          if (group.agentId && group.agentId.phone) {
            await sendSMS(
              group.agentId.phone,
              `IZIFINANCE: Group ${group.name} shortfall of KES ${shortfall.toFixed(2)}. Follow up with the group leader.`
            );
            console.log(`📩 Monthly Shortfall SMS Sent to Agent: ${group.agentId.name || 'Agent'} for group ${group.name}`);
          }

          // In-system Notification to Lender
          await Notification.create({
            userId: group.lenderId._id,
            userModel: "User",
            title: `Shortfall on ${group.name}`,
            message: `The group ${group.name} has a shortfall of KES ${shortfall.toFixed(2)} in their monthly repayment pool.`,
            type: "general"
          });
        } else {
            console.log(`✅ Group ${group.name} monthly repayment successful.`);
        }

        processingResults.push({
          groupName: group.name,
          expected: expectedAmount,
          actual: actualPoolAmount,
          shortfall: shortfall,
          status: status
        });

      } catch (groupError) {
        console.error(`❌ Error processing group ${group.name}:`, groupError);
        processingResults.push({
          groupName: group.name,
          error: groupError.message
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Monthly group repayment processing completed",
      results: processingResults
    });

  } catch (error) {
    console.error("❌ Error in processMonthlyGroupRepayments:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during monthly processing",
      error: error.message
    });
  }
};
