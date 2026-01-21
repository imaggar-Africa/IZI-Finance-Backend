const User = require("../models/User");
const Transaction = require("../models/Transaction");
const { sendMoneyToBorrower } = require("../utils/mpesa");
const AgentModel = require("../models/AgentModel");
const Loan = require("../models/Loan");

const Customer = require("../models/customer.js")
// Send money to borrower (B2C)
exports.sendMoneyToBorrower = async (req, res) => {
  try {
    const { lenderId, borrowerPhoneNumber, amount } = req.body;

    // Validate input fields
    if (!lenderId || !borrowerPhoneNumber || !amount) {
      return res.status(400).json({ message: "Lender ID, borrower phone number, and amount are required" });
    }

    // Find the lender
    const lender = await User.findById(lenderId);
    if (!lender || lender.role !== "lender") {
      return res.status(404).json({ message: "Lender not found" });
    }

    // Check if the lender has sufficient balance
    if (lender.walletBalance < amount) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    // Initiate B2C transaction
    const b2cResponse = await sendMoneyToBorrower(borrowerPhoneNumber, amount);

    // Update lender's wallet balance
    lender.walletBalance -= amount;
    await lender.save();

    // Record the transaction
    const transaction = new Transaction({
      userId: lenderId,
      type: "loan disbursement",
      amount: amount,
    });
    await transaction.save();

    // Return success response
    res.status(200).json({ message: "Money sent to borrower successfully", b2cResponse });
  } catch (error) {
    console.error("Error sending money to borrower:", error);
    res.status(500).json({ message: "Error sending money to borrower" });
  }
};


exports.getAllCustomersForLender = async (req, res) => {
  try {
    const lenderId = req.user._id;
    const today = new Date();

    // 1️⃣ Get all agents under this lender
    const agents = await AgentModel.find({ lenderId }).select("_id");
    const agentIds = agents.map(agent => agent._id);

    // 2️⃣ Get all customers
    const customers = await Customer.find({
      isDeleted: false,
      $or: [
        { registeredBy: lenderId, registeredByModel: "User" },
        { registeredBy: { $in: agentIds }, registeredByModel: "Agent" }
      ]
    })
      .populate("assignedAgent", "name phone status")
      .populate("agentId", "name phone status")
      .sort({ createdAt: -1 });

    // 3️⃣ Attach outstanding loan + computed status
    const customersWithStatus = await Promise.all(
      customers.map(async (customer) => {
        const loan = await Loan.findOne({
          borrowerId: customer._id,
          loanRequestStatus: "approved",
          status: { $in: ["active", "overdue"] }
        }).sort({ createdAt: -1 });

        const creditScore = loan?.creditScoreAfter ?? null;

        // ✅ ADD: Risk Level Calculation (TASK REQUIREMENT)
        let riskLevel = null;
        if (creditScore !== null) {
          if (creditScore >= 800) riskLevel = "Low";
          else if (creditScore >= 600) riskLevel = "Medium";
          else riskLevel = "High";
        }

        // ✅ Base customer object
        const baseCustomer = {
          ...customer.toObject(),
          creditScore,
          riskLevel
        };

        // 🔹 No active loan
        if (!loan) {
          return {
            ...baseCustomer,
            outstandingLoan: null,
            loanStatus: customer.isVerified
              ? { badge: "ELIGIBLE", color: "blue", label: "✔ Eligible", allowLend: true }
              : { badge: "NO_LOAN", color: "gray", label: "No active loan" }
          };
        }

        // 🔹 Calculations
        const totalDue = loan.totalRepayment;
        const amountPaid = loan.repaidAmount || 0;
        const totalOutstanding = totalDue - amountPaid;

        const daysToDue = Math.ceil((loan.dueDate - today) / (1000 * 60 * 60 * 24));
        const daysOverdue =
          today > loan.dueDate
            ? Math.ceil((today - loan.dueDate) / (1000 * 60 * 60 * 24))
            : 0;

        const repaymentRatio = amountPaid / totalDue;

        const daysElapsed = Math.max(
          0,
          Math.ceil((today - loan.issueDate) / (1000 * 60 * 60 * 24))
        );

        const expectedRatioByToday = Math.min(1, daysElapsed / loan.duration);

        // 🔴 OVERDUE
        if (today > loan.dueDate && totalOutstanding > 0) {
          return {
            ...baseCustomer,
            outstandingLoan: loan,
            loanMetrics: { totalOutstanding, repaymentRatio, daysOverdue },
            loanStatus: {
              badge: "OVERDUE",
              color: "red",
              label: "⛔ Overdue",
              daysOverdue,
              lockNewLoans: true
            }
          };
        }

        // 🟠 AT-RISK
        if (
          loan.status === "active" &&
          ((daysToDue <= 2 && repaymentRatio < 0.8) ||
            repaymentRatio < expectedRatioByToday)
        ) {
          return {
            ...baseCustomer,
            outstandingLoan: loan,
            loanMetrics: {
              totalOutstanding,
              repaymentRatio,
              expectedRatioByToday,
              daysToDue
            },
            loanStatus: {
              badge: "AT_RISK",
              color: "amber",
              label: "⚠ At-risk",
              showReminder: true
            }
          };
        }

        // 🟢 ON-TRACK
        if (repaymentRatio >= expectedRatioByToday) {
          return {
            ...baseCustomer,
            outstandingLoan: loan,
            loanMetrics: { totalOutstanding, repaymentRatio, daysToDue },
            loanStatus: {
              badge: "ON_TRACK",
              color: "green",
              label: "✔ On-track",
              nextDueDate: loan.dueDate
            }
          };
        }

        // 🟢 CLEARED
        if (totalOutstanding === 0) {
          return {
            ...baseCustomer,
            outstandingLoan: null,
            loanStatus: { badge: "CLEARED", color: "green", label: "✔ Cleared" }
          };
        }

        return {
          ...baseCustomer,
          outstandingLoan: loan,
          loanStatus: { badge: "UNKNOWN", label: "Unknown" }
        };
      })
    );

    res.status(200).json({
      success: true,
      count: customersWithStatus.length,
      customers: customersWithStatus
    });

  } catch (error) {
    console.error("❌ Error fetching customers:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};



exports.assignCustomerToAgent = async (req, res) => {
  try {
    const { customerId, agentId } = req.body;
    const lenderId = req.user._id; // from JWT (Lender login)

    // ✅ Fetch agent and check lender ownership
    const agent = await AgentModel.findById(agentId);
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    if (agent.lenderId.toString() !== lenderId.toString()) {
      return res.status(403).json({ message: "Cannot assign customer to agent from another lender" });
    }

    // ✅ Fetch customer
    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    // ✅ Check if already assigned
    if (customer.assignedAgent) {
      if (customer.assignedAgent.toString() === agentId) {
        return res.status(400).json({ message: "Customer is already assigned to this agent" });
      } else {
        return res.status(400).json({ 
          message: "Customer is already assigned to another agent",
          assignedAgent: customer.assignedAgent
        });
      }
    }

    // ✅ Assign agent to customer
    customer.assignedAgent = agentId;
    await customer.save();

    // ✅ Add this customer under the agent (avoid duplicates)
    await agent.addCustomer(customerId);

    // ✅ Populate agent info in response
    const updatedCustomer = await Customer.findById(customerId)
      .populate("assignedAgent", "name email phone");

    res.status(200).json({
      message: "Customer assigned to agent successfully",
      customer: updatedCustomer,
    });
  } catch (error) {
    console.error("Error assigning customer:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.getAgentsByLender = async (req, res) => {
  try {
    if (req.user.role !== "lender") {
      return res.status(403).json({ message: "Access denied. Only lenders can view agents." });
    }

    const lenderId = req.user._id;

    // 🔹 Populate full customer data
    const agents = await AgentModel.find({ lenderId })
      .populate({
        path: "customers",
        model: "Customer", // ensure correct model name
      })
      .select("-password -__v");

    if (!agents.length) {
      return res.status(404).json({ message: "No agents found for this lender." });
    }

    res.status(200).json({
      message: "Agents fetched successfully",
      lender: {
        id: req.user._id,
        name: req.user.name,
        phone: req.user.phone,
      },
      totalAgents: agents.length,
      agents,
    });
  } catch (error) {
    console.error("Error fetching agents:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

