const User = require("../models/User");
const Profile = require("../models/Profile");
const Transaction = require("../models/Transaction");
const { sendMoneyToBorrower } = require("../utils/mpesa");
const AgentModel = require("../models/AgentModel");
const Loan = require("../models/Loan");
const { normalizePhone } = require("../utils/normalizePhone");


const Customer = require("../models/customer.js");
const Group = require("../models/Group");
const Guarantor = require("../models/Guarantor.js");
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


// exports.getAllCustomersForLender = async (req, res) => {
//   try {
//     const lenderId = req.user._id;
//     const today = new Date();

//     // 1️⃣ Get all agents under this lender
//     const agents = await AgentModel.find({ lenderId }).select("_id");
//     const agentIds = agents.map(agent => agent._id);

//     // 2️⃣ Get all customers
//     const customers = await Customer.find({
//       isDeleted: false,
//       $or: [
//         { registeredBy: lenderId, registeredByModel: "User" },
//         { registeredBy: { $in: agentIds }, registeredByModel: "Agent" }
//       ]
//     })
//       .populate("assignedAgent", "name phone status")
//       .populate("agentId", "name phone status")
//       .sort({ createdAt: -1 });

//     /* =====================================================
//        ✅ NEW: FETCH REFERRED BORROWERS (OPTIMIZED)
//     ===================================================== */

//     const referredIds = customers
//       .map(c => c.referredByBorrowerId)
//       .filter(id => id !== null);

//     const referredBorrowers = await Customer.find({
//       _id: { $in: referredIds }
//     }).select("fullName phone");

//     const referredMap = {};
//     referredBorrowers.forEach(rb => {
//       referredMap[rb._id.toString()] = rb;
//     });

//     /* =====================================================
//        ✅ FETCH GUARANTORS (EXISTING OPTIMIZED LOGIC)
//     ===================================================== */

//     const customerIds = customers.map(c => c._id);

//     const allGuarantors = await Guarantor.find({
//       borrowerId: { $in: customerIds },
//       isDeleted: false
//     });

//     const guarantorMap = {};
//     allGuarantors.forEach(g => {
//       const id = g.borrowerId.toString();
//       if (!guarantorMap[id]) guarantorMap[id] = [];
//       guarantorMap[id].push(g);
//     });

//     // 3️⃣ Attach outstanding loan + computed status
//     const customersWithStatus = await Promise.all(
//       customers.map(async (customer) => {

//         const loan = await Loan.findOne({
//           borrowerId: customer._id,
//           loanRequestStatus: "approved",
//           status: { $in: ["active", "overdue"] }
//         }).sort({ createdAt: -1 });

//         const creditScore = customer.creditScore ?? null;

//         // ✅ Risk Level Calculation
//         let riskLevel = null;
//         if (creditScore !== null) {
//           if (creditScore >= 800) riskLevel = "Low";
//           else if (creditScore >= 600) riskLevel = "Medium";
//           else riskLevel = "High";
//         }

//         // ✅ Base customer object (ONLY additions: guarantors + referredByBorrower)
//         const baseCustomer = {
//           ...customer.toObject(),
//           creditScore,
//           riskLevel,
//           guarantors: guarantorMap[customer._id.toString()] || [],
//           referredByBorrower:
//             customer.referredByBorrowerId
//               ? referredMap[customer.referredByBorrowerId.toString()] || null
//               : null
//         };

//         // 🔹 No active loan
//         if (!loan) {
//           return {
//             ...baseCustomer,
//             outstandingLoan: null,
//             loanStatus: customer.isVerified
//               ? { badge: "ELIGIBLE", color: "blue", label: "✔ Eligible", allowLend: true }
//               : { badge: "NO_LOAN", color: "gray", label: "No active loan" }
//           };
//         }

//         // 🔹 Calculations
//         const totalDue = loan.totalRepayment;
//         const amountPaid = loan.repaidAmount || 0;
//         const totalOutstanding = totalDue - amountPaid;

//         const daysToDue = Math.ceil((loan.dueDate - today) / (1000 * 60 * 60 * 24));
//         const daysOverdue =
//           today > loan.dueDate
//             ? Math.ceil((today - loan.dueDate) / (1000 * 60 * 60 * 24))
//             : 0;

//         const repaymentRatio = amountPaid / totalDue;

//         const daysElapsed = Math.max(
//           0,
//           Math.ceil((today - loan.issueDate) / (1000 * 60 * 60 * 24))
//         );

//         const expectedRatioByToday = Math.min(1, daysElapsed / loan.duration);

//         // 🔴 OVERDUE
//         if (today > loan.dueDate && totalOutstanding > 0) {
//           return {
//             ...baseCustomer,
//             outstandingLoan: loan,
//             loanMetrics: { totalOutstanding, repaymentRatio, daysOverdue },
//             loanStatus: {
//               badge: "OVERDUE",
//               color: "red",
//               label: "⛔ Overdue",
//               daysOverdue,
//               lockNewLoans: true
//             }
//           };
//         }

//         // 🟠 AT-RISK
//         if (
//           loan.status === "active" &&
//           ((daysToDue <= 2 && repaymentRatio < 0.8) ||
//             repaymentRatio < expectedRatioByToday)
//         ) {
//           return {
//             ...baseCustomer,
//             outstandingLoan: loan,
//             loanMetrics: {
//               totalOutstanding,
//               repaymentRatio,
//               expectedRatioByToday,
//               daysToDue
//             },
//             loanStatus: {
//               badge: "AT_RISK",
//               color: "amber",
//               label: "⚠ At-risk",
//               showReminder: true
//             }
//           };
//         }

//         // 🟢 ON-TRACK
//         if (repaymentRatio >= expectedRatioByToday) {
//           return {
//             ...baseCustomer,
//             outstandingLoan: loan,
//             loanMetrics: { totalOutstanding, repaymentRatio, daysToDue },
//             loanStatus: {
//               badge: "ON_TRACK",
//               color: "green",
//               label: "✔ On-track",
//               nextDueDate: loan.dueDate
//             }
//           };
//         }

//         // 🟢 CLEARED
//         if (totalOutstanding === 0) {
//           return {
//             ...baseCustomer,
//             outstandingLoan: null,
//             loanStatus: { badge: "CLEARED", color: "green", label: "✔ Cleared" }
//           };
//         }

//         return {
//           ...baseCustomer,
//           outstandingLoan: loan,
//           loanStatus: { badge: "UNKNOWN", label: "Unknown" }
//         };
//       })
//     );

//     res.status(200).json({
//       success: true,
//       count: customersWithStatus.length,
//       customers: customersWithStatus
//     });

//   } catch (error) {
//     console.error("❌ Error fetching customers:", error);
//     res.status(500).json({
//       success: false,
//       message: "Server error"
//     });
//   }
// };

exports.getAllCustomersForLender = async (req, res) => {
  try {
    const lenderId = req.user._id;
    const today = new Date();

    /* ================================
       1️⃣ FETCH AGENTS
    ================================= */
    const agents = await AgentModel.find({ lenderId }).select("_id");
    const agentIds = agents.map(a => a._id);

    /* ================================
       2️⃣ FETCH CUSTOMERS
    ================================= */
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

    /* ================================
       REFERRED BORROWERS
    ================================= */
    const referredIds = customers
      .map(c => c.referredByBorrowerId)
      .filter(Boolean);

    const referredBorrowers = await Customer.find({
      _id: { $in: referredIds }
    }).select("fullName phone");

    const referredMap = {};
    referredBorrowers.forEach(rb => {
      referredMap[rb._id.toString()] = rb;
    });

    /* ================================
       GUARANTORS
    ================================= */
    const customerIds = customers.map(c => c._id);

    const guarantors = await Guarantor.find({
      borrowerId: { $in: customerIds },
      isDeleted: false
    });

    const guarantorMap = {};
    guarantors.forEach(g => {
      const id = g.borrowerId.toString();
      if (!guarantorMap[id]) guarantorMap[id] = [];
      guarantorMap[id].push(g);
    });

    /* ================================
       PROCESS EACH CUSTOMER
    ================================= */
    const customersWithStatus = await Promise.all(
      customers.map(async (customer) => {

        const creditScore = customer.creditScore ?? 500;

        /* ================================
           🔎 FETCH ONLY APPROVED LOANS
        ================================= */
        const loans = await Loan.find({
          borrowerId: customer._id,
          loanRequestStatus: "approved"
        });

        const totalLoans = loans.length;

        const completedLoans = loans.filter(
          l =>
            l.status === "fully paid" ||
            (l.repaidAmount >= l.totalRepayment && l.totalRepayment > 0)
        ).length;

        const overdueLoans = loans.filter(
          l => l.status === "overdue"
        ).length;

        const activeLoan = loans.find(
          l =>
            l.status === "active" ||
            l.status === "pending" || // approved but not activated
            l.status === "overdue"
        );

        /* ================================
           🎯 RISK ENGINE
        ================================= */
        let riskLevel = "LOW";
        let maxEligibleAmount = 0;
        let canTakeNextLoan = false;

        // 🟢 BRAND NEW
        if (totalLoans === 0) {
          riskLevel = "NEW";
          maxEligibleAmount = 1000;
          canTakeNextLoan = true;
        }

        // 🔴 HAS OVERDUE
        else if (overdueLoans > 0) {
          riskLevel = "HIGH";
          maxEligibleAmount = 0;
          canTakeNextLoan = false;
        }

        // 🟢 COMPLETED ≥ 1
        else if (completedLoans >= 1) {

          if (creditScore < 600) {
            riskLevel = "PROGRESSIVE";
            maxEligibleAmount = 2000;
          } else if (creditScore < 700) {
            riskLevel = "MEDIUM";
            maxEligibleAmount = 5000;
          } else {
            riskLevel = "LOW";//above 800
            maxEligibleAmount = 10000;
          }

          canTakeNextLoan = true;
        }

        // 🟡 ACTIVE LOAN EXISTS
        else if (activeLoan) {
          riskLevel = "ACTIVE";
          maxEligibleAmount = 0;
          canTakeNextLoan = false;
        }

        const baseCustomer = {
          ...customer.toObject(),

          // 🔥 OVERRIDE WITH REAL CALCULATED VALUES
          totalLoans,
          completedLoans,
          overdueLoans,

          creditScore,
          riskLevel,
          maxEligibleAmount,
          canTakeNextLoan,

          guarantors: guarantorMap[customer._id.toString()] || [],

          referredByBorrower:
            customer.referredByBorrowerId
              ? referredMap[customer.referredByBorrowerId.toString()] || null
              : null
        };

        /* ================================
           NO ACTIVE LOAN
        ================================= */
        if (!activeLoan) {
          return {
            ...baseCustomer,
            outstandingLoan: null,
            loanStatus: {
              badge: "ELIGIBLE",
              color: "blue",
              label: "✔ Eligible",
              allowLend: canTakeNextLoan
            }
          };
        }

        /* ================================
           ACTIVE / OVERDUE METRICS
        ================================= */
        const totalDue = activeLoan.totalRepayment;
        const amountPaid = activeLoan.repaidAmount || 0;
        const totalOutstanding = totalDue - amountPaid;

        const daysOverdue =
          today > activeLoan.dueDate
            ? Math.ceil(
              (today - activeLoan.dueDate) /
              (1000 * 60 * 60 * 24)
            )
            : 0;

        let repaymentRatio = 0;
        if (totalDue > 0) {
          repaymentRatio = amountPaid / totalDue;
        }

        if (daysOverdue > 0 && totalOutstanding > 0) {
          return {
            ...baseCustomer,
            outstandingLoan: activeLoan,
            loanMetrics: {
              totalOutstanding,
              repaymentRatio,
              daysOverdue
            },
            loanStatus: {
              badge: "OVERDUE",
              color: "red",
              label: "⛔ Overdue",
              daysOverdue,
              lockNewLoans: true
            }
          };
        }

        return {
          ...baseCustomer,
          outstandingLoan: activeLoan,
          loanMetrics: {
            totalOutstanding,
            repaymentRatio
          },
          loanStatus: {
            badge: "ACTIVE",
            color: "green",
            label: "✔ Active Loan",
            lockNewLoans: true
          }
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

    // 🔹 Populate full customer data and calculate metrics
    const rawAgents = await AgentModel.find({ lenderId })
      .populate({
        path: "customers",
        model: "Customer",
      })
      .select("-password -__v");

    if (!rawAgents.length) {
      return res.status(404).json({ message: "No agents found for this lender." });
    }

    const agents = await Promise.all(
      rawAgents.map(async (agent) => {
        const agentObj = agent.toObject();
        const customerIds = agent.customers.map((c) => c._id);

        // 1️⃣ Number of groups under that agent
        const numGroups = await Group.countDocuments({ agentId: agent._id });

        // 2️⃣ Number of customers under that agent
        const numCustomers = customerIds.length;

        // 3️⃣ Number of defaulters under that agent (customers with overdue loans)
        const numDefaulters = (
          await Loan.distinct("borrowerId", {
            borrowerId: { $in: customerIds },
            status: "overdue",
          })
        ).length;

        // 4️⃣ Total amount disbursed under that agent
        const totalDisbursedResult = await Loan.aggregate([
          {
            $match: {
              borrowerId: { $in: customerIds },
              loanRequestStatus: "approved",
            },
          },
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);
        const totalDisbursed = totalDisbursedResult.length > 0 ? totalDisbursedResult[0].total : 0;

        return {
          ...agentObj,
          metrics: {
            numGroups,
            numCustomers,
            numDefaulters,
            totalDisbursed,
          },
        };
      })
    );

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

/* =====================================================
   🆕 EDIT CUSTOMER PROFILE (LENDER ONLY)
===================================================== */
exports.updateBorrowerProfile = async (req, res) => {
  try {
    const { customerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({ message: "Invalid customer ID" });
    }

    const borrower = await Borrower.findById(customerId);
    if (!borrower) {
      return res.status(404).json({ message: "Customer not found" });
    }

    /* ================= BORROWER UPDATE ================= */

    const restrictedBorrowerFields = [
      "_id",
      "creditScore",
      "creditLevel",
      "maxLoanLimit",
      "totalLoans",
      "completedLoans",
      "overdueLoans",
      "lastScoreUpdate",
      "createdAt",
      "updatedAt",
      "__v",
      "isDeleted"
    ];

    const borrowerUpdateData = {};

    Object.keys(req.body).forEach((key) => {
      if (
        !restrictedBorrowerFields.includes(key) &&
        !key.startsWith("guarantor")
      ) {
        const value = req.body[key];
        borrowerUpdateData[key] =
          value === "null" || value === "" ? null : value;
      }
    });

    if (borrowerUpdateData.phone) {
      const normalized = normalizePhone(borrowerUpdateData.phone);
      if (!normalized) {
        return res.status(400).json({ message: "Invalid borrower phone" });
      }
      borrowerUpdateData.phone = normalized;
    }

    borrowerUpdateData.updatedAt = Date.now();

    if (Object.keys(borrowerUpdateData).length > 0) {
      await Borrower.updateOne(
        { _id: customerId },
        { $set: borrowerUpdateData }
      );
    }

    /* ================= GUARANTOR UPDATE ================= */

    const guarantor = await Guarantor.findOne({
      $or: [
        { borrowerId: customerId },
        { borrowerId: new mongoose.Types.ObjectId(customerId) }
      ],
      isDeleted: false
    });

    if (guarantor) {
      const guarantorUpdateData = {};

      if (req.body.guarantorFullName)
        guarantorUpdateData.fullName = req.body.guarantorFullName.trim();

      const relationshipInput =
        req.body.guarantorRelationship || req.body.relationship;

      if (relationshipInput !== undefined) {
        guarantorUpdateData.relationship =
          String(relationshipInput).trim();
      }

      if (req.body.guarantorIdNumber)
        guarantorUpdateData.idNumber =
          req.body.guarantorIdNumber.trim();

      if (req.body.guarantorPhone) {
        const normalizedPhone = normalizePhone(req.body.guarantorPhone);

        if (!normalizedPhone) {
          return res.status(400).json({
            message: "Invalid guarantor phone"
          });
        }

        if (normalizedPhone !== guarantor.phone) {
          guarantorUpdateData.phone = normalizedPhone;
          guarantorUpdateData.consent = false;
          guarantorUpdateData.isVerified = false;
          guarantorUpdateData.consent_timestamp = null;
        }
      }

      if (Object.keys(guarantorUpdateData).length > 0) {
        await Guarantor.updateOne(
          { _id: guarantor._id },
          { $set: guarantorUpdateData }
        );
      }
    }

    /* ================= FINAL FETCH ================= */

    const updatedBorrower = await Borrower.findById(customerId);
    const updatedGuarantor = await Guarantor.findOne({
      borrowerId: customerId,
      isDeleted: false
    });

    return res.status(200).json({
      success: true,
      message: "Customer and guarantor updated successfully",
      borrower: updatedBorrower,
      guarantor: updatedGuarantor
    });

  } catch (error) {
    console.error("❌ updateBorrowerProfile error:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        message: "Duplicate guarantor phone for this borrower"
      });
    }

    return res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};


exports.editAgent = async (req, res) => {
  try {
    const lenderId = req.user._id;
    const { agentId } = req.params;
    const { name, phone, email, status } = req.body;

    const agent = await AgentModel.findById(agentId);
    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }

    // ✅ Ownership check
    if (agent.lenderId.toString() !== lenderId.toString()) {
      return res.status(403).json({
        message: "You are not allowed to edit this agent"
      });
    }

    // ✅ Phone uniqueness check
    if (phone && phone !== agent.phone) {
      const existing = await AgentModel.findOne({
        phone,
        _id: { $ne: agentId }
      });

      if (existing) {
        return res.status(409).json({
          message: "Phone number already in use"
        });
      }

      agent.phone = phone;
    }

    if (name) agent.name = name;
    if (email) agent.email = email;
    if (status) agent.status = status;

    await agent.save();

    res.status(200).json({
      message: "Agent updated successfully",
      agent
    });

  } catch (error) {
    console.error("❌ Error editing agent:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};

/* =====================================================
   📷 UPDATE LENDER SELFIE
===================================================== */
exports.updateSelfie = async (req, res) => {
  try {
    const userId = req.user._id;

    // 1️⃣ Check if file exists (provided by firebaseSafeUpload)
    const selfieFile = req.files?.selfie?.[0];

    if (!selfieFile || !selfieFile.url) {
      return res.status(400).json({
        success: false,
        message: "Selfie image is required"
      });
    }

    // 2️⃣ Find or Create Profile
    let profile = await Profile.findOne({ userId });

    if (!profile) {
      // Fallback: If no profile exists, create one using user data
      const user = await User.findById(userId);
      profile = new Profile({
        userId,
        fullName: user.name || "Lender",
        phone: user.phone,
        idNumber: "PENDING"
      });
    }

    // 3️⃣ Update Selfie URL
    profile.selfie = selfieFile.url;
    await profile.save();

    return res.status(200).json({
      success: true,
      message: "Selfie updated successfully",
      selfieUrl: profile.selfie
    });

  } catch (error) {
    console.error("❌ updateSelfie error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating selfie",
      error: error.message
    });
  }
};

exports.removeAgent = async (req, res) => {
  try {
    const lenderId = req.user._id;
    const { agentId } = req.params;

    const agent = await AgentModel.findById(agentId);
    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }

    // 🔐 Ownership check
    if (agent.lenderId.toString() !== lenderId.toString()) {
      return res.status(403).json({
        message: "You are not allowed to remove this agent"
      });
    }

    // ✅ Soft delete properly
    agent.isDeleted = true;
    agent.status = "Inactive";   // 👈 use valid enum value
    agent.enforcementLevel = 3;  // permanently blocked
    agent.blockReason = "Removed by lender";
    agent.suspensionUntil = null;
    agent.warningReason = null;

    await agent.save();

    // 🔄 Optional: Unassign customers
    await Customer.updateMany(
      { assignedAgent: agentId },
      { $unset: { assignedAgent: "" } }
    );

    res.status(200).json({
      success: true,
      message: "Agent marked as InActive successfully"
    });

  } catch (error) {
    console.error("❌ Error removing agent:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};

exports.enforceAgent = async (req, res) => {
  try {
    const lenderId = req.user._id;
    const { agentId } = req.params;
    const { level, reason, suspensionHours } = req.body;

    const agent = await AgentModel.findById(agentId);
    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }

    // Ownership validation
    if (agent.lenderId.toString() !== lenderId.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // LEVEL 1 — WARNING
    if (level === 1) {
      agent.enforcementLevel = 1;
      agent.warningReason = reason || "Policy warning issued";
      agent.status = "Active";
    }

    // LEVEL 2 — TEMP SUSPENSION
    else if (level === 2) {
      const hours = suspensionHours || 24; // default 24h
      const suspensionDate = new Date();
      suspensionDate.setHours(suspensionDate.getHours() + hours);

      agent.enforcementLevel = 2;
      agent.suspensionUntil = suspensionDate;
      agent.blockReason = reason || "Temporary suspension";
      agent.status = "Suspended";
    }

    // LEVEL 3 — PERMANENT BLOCK
    else if (level === 3) {
      agent.enforcementLevel = 3;
      agent.status = "Blocked";
      agent.blockReason = reason || "Permanent block";
      agent.suspensionUntil = null;
    }

    else {
      return res.status(400).json({
        message: "Invalid enforcement level (1, 2, or 3 required)"
      });
    }

    await agent.save();

    res.status(200).json({
      message: "Enforcement applied successfully",
      agent
    });

  } catch (error) {
    console.error("❌ Enforcement error:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};