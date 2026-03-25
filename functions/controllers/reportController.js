const Loan = require("../models/Loan");
const Customer = require("../models/customer");
const Transaction = require("../models/Transaction");
const Agent = require("../models/AgentModel");
const AgentCommission = require("../models/AgentCommission");
const NodeCache = require("node-cache");
const dashboardCache = new NodeCache({ stdTTL: 60 }); // cache 60 sec
const mongoose = require("mongoose");


exports.getDashboardReport = async (req, res) => {
  try {
    const lenderId = req.user._id;
    const now = new Date();

    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    const baseFilter = {
      lenderId,
      loanRequestStatus: "approved",
      isDeleted: { $ne: true },
      isWrittenOff: { $ne: true }
    };

    /* ===============================
       TOTAL PORTFOLIO
    =============================== */

    /* ===============================
       🔥🔥🔥 DASHBOARD KPI AGGREGATION
    =============================== */

    const kpiSummary = await Loan.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id: null,
          totalPortfolio: { 
            $sum: { $cond: [{ $in: ["$status", ["active", "overdue"]] }, "$balance", 0] } 
          },
          totalDisbursed: { $sum: "$amount" },
          totalCollected: { $sum: "$repaidAmount" },
          activeLoans: { 
            $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } 
          },
          totalLoans: { $sum: 1 },
          defaultedLoans: { 
            $sum: { $cond: ["$isDefaulted", 1, 0] } 
          },
          // Approximate interest collected proportionally
          interestEarned: {
            $sum: {
              $multiply: [
                "$interest",
                { 
                  $cond: [
                    { $gt: ["$totalRepayment", 0] }, 
                    { $divide: ["$repaidAmount", "$totalRepayment"] }, 
                    0
                  ] 
                }
              ]
            }
          }
        }
      }
    ]);

    const kpis = kpiSummary[0] || {
      totalPortfolio: 0,
      totalDisbursed: 0,
      totalCollected: 0,
      activeLoans: 0,
      totalLoans: 0,
      defaultedLoans: 0,
      interestEarned: 0
    };

    /* ===============================
       ACTIVE LOANS & BORROWERS
    =============================== */

    const activeLoans = await Loan.countDocuments({
      ...baseFilter,
      status: "active"
    });

    const activeBorrowers = await Loan.distinct(
      "borrowerId",
      {
        ...baseFilter,
        status: "active"
      }
    );

    /* ===============================
       DEFAULT RATE
    =============================== */

    const defaultRate =
      kpis.totalLoans > 0
        ? Number(((kpis.defaultedLoans / kpis.totalLoans) * 100).toFixed(2))
        : 0;

    /* ===============================
       PAR
    =============================== */

    const overdueLoans = await Loan.find({
      ...baseFilter,
      status: "overdue"
    });

    let par1 = 0, par7 = 0, par30 = 0;

    overdueLoans.forEach((loan) => {
      const days =
        (now - new Date(loan.dueDate)) /
        (1000 * 60 * 60 * 24);

      if (days >= 1) par1 += loan.balance;
      if (days >= 7) par7 += loan.balance;
      if (days >= 30) par30 += loan.balance;
    });

    const par = {
      PAR1: kpis.totalPortfolio
        ? Number(((par1 / kpis.totalPortfolio) * 100).toFixed(2))
        : 0,
      PAR7: kpis.totalPortfolio
        ? Number(((par7 / kpis.totalPortfolio) * 100).toFixed(2))
        : 0,
      PAR30: kpis.totalPortfolio
        ? Number(((par30 / kpis.totalPortfolio) * 100).toFixed(2))
        : 0
    };

    /* ===============================
       TRENDS
    =============================== */

    /* ===============================
       📈 TRENDS (CORRECTED)
    =============================== */

    const disbursementTrend = await Loan.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$issueDate" } },
          amount: { $sum: "$amount" }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Trend based on actual transaction records
    const repaymentTrend = await Transaction.aggregate([
      {
        $match: {
          type: "repayment",
          status: "successful"
        }
      },
      {
        $lookup: {
          from: "loans",
          localField: "loanId",
          foreignField: "_id",
          as: "loan"
        }
      },
      { $unwind: "$loan" },
      { $match: { "loan.lenderId": new mongoose.Types.ObjectId(lenderId) } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          amount: { $sum: "$amount" }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const loanGrowthTrend = await Loan.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$issueDate" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const defaultTrend = await Loan.aggregate([
      { $match: { ...baseFilter, isDefaulted: true } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$updatedAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    /* ===============================
       TODAY SNAPSHOT
    =============================== */

    const loansIssuedToday = await Loan.countDocuments({
      ...baseFilter,
      createdAt: { $gte: startOfToday }
    });

    const repaymentsTodayAggregation = await Transaction.aggregate([
      {
        $match: {
          type: "repayment",
          status: "successful",
          createdAt: { $gte: startOfToday }
        }
      },
      {
        $lookup: {
          from: "loans",
          localField: "loanId",
          foreignField: "_id",
          as: "loan"
        }
      },
      { $unwind: "$loan" },
      { $match: { "loan.lenderId": new mongoose.Types.ObjectId(lenderId) } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const overdueLoansCount = overdueLoans.length;

    // Check agents active today by their documented activity
    const activeAgentsFromLoans = await Loan.distinct("requestedByAgentId", {
      lenderId,
      issueDate: { $gte: startOfToday }
    });
    const activeAgentsFromCustomers = await Customer.distinct("agentId", {
      lenderId,
      createdAt: { $gte: startOfToday }
    });
    
    // Combine unique agent IDs
    const uniqueAgentIds = new Set([
      ...activeAgentsFromLoans, 
      ...activeAgentsFromCustomers
    ].filter(id => id));

    const agentsActiveToday = uniqueAgentIds.size;

    return res.json({
      success: true,
      dashboardSummary: {
        totalLoanPortfolio: kpis.totalPortfolio,
        totalDisbursed: kpis.totalDisbursed,
        totalCollected: kpis.totalCollected,
        portfolioAtRisk: par,
        activeBorrowers: activeBorrowers.length,
        activeLoans: kpis.activeLoans,
        totalProfitInterestEarned: Math.round(kpis.interestEarned),
        defaultRate
      },
      trends: {
        disbursementTrend,
        repaymentTrend,
        loanGrowthTrend,
        defaultTrend
      },
      operationalSnapshot: {
        loansIssuedToday,
        repaymentsReceivedToday: repaymentsTodayAggregation[0]?.total || 0,
        overdueLoans: overdueLoansCount,
        agentsActiveToday
      }
    });

  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/* ===========================
   LOANS REPORT
=========================== */

exports.getLoansReport = async (req, res) => {
  try {
    const lenderId = req.user.id;

    /* =====================================================
       BASE FILTER (ONLY ISSUED LOANS)
    ===================================================== */

    const loans = await Loan.find({
      lenderId,
      loanRequestStatus: "approved",
      status: { $in: ["active", "overdue", "fully paid"] }
    })
      .populate("borrowerId", "fullName creditLevel")
      .populate("requestedByAgentId", "name");

    /* =====================================================
       1️⃣ LOAN VOLUME METRICS
    ===================================================== */

    const totalLoansIssued = loans.length;

    const totalAmountDisbursed = loans.reduce(
      (sum, l) => sum + (l.amount || 0),
      0
    );

    const averageLoanSize =
      totalLoansIssued > 0
        ? Number((totalAmountDisbursed / totalLoansIssued).toFixed(2))
        : 0;

    /* Loans by Product */
    const productMap = {};
    loans.forEach(l => {
      const product = l.productType || "general";
      productMap[product] = (productMap[product] || 0) + 1;
    });

    const loansByProduct = Object.keys(productMap).map(key => ({
      product: key,
      count: productMap[key],
      percentage:
        totalLoansIssued > 0
          ? Number(((productMap[key] / totalLoansIssued) * 100).toFixed(2))
          : 0
    }));

    /* Loans by Agent */
    const agentMap = {};
    loans.forEach(l => {
      const agentName = l.requestedByAgentId?.name || "Direct";
      agentMap[agentName] = (agentMap[agentName] || 0) + 1;
    });

    const loansByAgent = Object.keys(agentMap).map(agentName => ({
      agentName,
      loanCount: agentMap[agentName]
    }));

    /* =====================================================
       2️⃣ LOAN STATUS BREAKDOWN (Graph Ready)
    ===================================================== */

    const statusBreakdown = {
      active: 0,
      completed: 0,
      defaulted: 0,
      restructured: 0
    };

    loans.forEach(l => {
      if (l.isDefaulted) statusBreakdown.defaulted++;
      else if (l.status === "fully paid") statusBreakdown.completed++;
      else if (l.status === "active") statusBreakdown.active++;
      else if (l.isRestructured) statusBreakdown.restructured++;
    });

    const loanStatusBreakdown = [
      { status: "active", count: statusBreakdown.active },
      { status: "completed", count: statusBreakdown.completed },
      { status: "defaulted", count: statusBreakdown.defaulted },
      { status: "restructured", count: statusBreakdown.restructured }
    ];

    /* =====================================================
       3️⃣ LOAN STATUS TREND (Daily / Weekly / Monthly)
    ===================================================== */

    const baseMatch = {
      lenderId: new mongoose.Types.ObjectId(lenderId),
      loanRequestStatus: "approved"
    };

    // DAILY
    const dailyRaw = await Loan.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: {
            year: { $year: "$issueDate" },
            month: { $month: "$issueDate" },
            day: { $dayOfMonth: "$issueDate" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } }
    ]);

    const dailyTrend = dailyRaw.map(t => ({
      year: t._id.year,
      month: t._id.month,
      day: t._id.day,
      count: t.count
    }));

    // WEEKLY
    const weeklyRaw = await Loan.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: {
            year: { $year: "$issueDate" },
            week: { $week: "$issueDate" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.week": 1 } }
    ]);

    const weeklyTrend = weeklyRaw.map(t => ({
      year: t._id.year,
      week: t._id.week,
      count: t.count
    }));

    // MONTHLY
    const monthlyRaw = await Loan.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: {
            year: { $year: "$issueDate" },
            month: { $month: "$issueDate" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    const monthlyTrend = monthlyRaw.map(t => ({
      year: t._id.year,
      month: t._id.month,
      count: t.count
    }));

    /* =====================================================
       4️⃣ NEW vs REPEAT BORROWERS
    ===================================================== */

    const borrowerLoanCount = {};

    loans.forEach(l => {
      const borrowerId = l.borrowerId?._id?.toString();
      if (!borrowerId) return;
      borrowerLoanCount[borrowerId] =
        (borrowerLoanCount[borrowerId] || 0) + 1;
    });

    let firstTime = 0;
    let repeat = 0;

    Object.values(borrowerLoanCount).forEach(count => {
      if (count === 1) firstTime++;
      else repeat++;
    });

    const totalBorrowers = firstTime + repeat;

    const firstTimeRatio =
      totalBorrowers > 0
        ? Number(((firstTime / totalBorrowers) * 100).toFixed(2))
        : 0;

    /* =====================================================
       5️⃣ RISK INDICATORS
    ===================================================== */

    const today = new Date();
    let highRiskLoans = 0;
    let nearingDueDate = 0;

    const overdueAmount = loans
      .filter(l => l.status === "overdue")
      .reduce((sum, l) => sum + (l.balance || 0), 0);

    loans.forEach(l => {
      const daysToDue = Math.floor(
        (new Date(l.dueDate) - today) / (1000 * 60 * 60 * 24)
      );

      if (l.isDefaulted || l.balance > l.amount * 0.5) {
        highRiskLoans++;
      }

      if (daysToDue >= 0 && daysToDue <= 7) {
        nearingDueDate++;
      }
    });

    /* =====================================================
       RESPONSE
    ===================================================== */

    res.json({
      success: true,

      loanVolumeMetrics: {
        totalLoansIssued,
        totalAmountDisbursed,
        averageLoanSize,
        loansByProduct,
        loansByAgent
      },

      loanStatusBreakdown,

      loanStatusBreakdownTrend: {
        daily: dailyTrend,
        weekly: weeklyTrend,
        monthly: monthlyTrend
      },

      disbursementAnalysis: {
        monthlyTrend: monthlyTrend,
        newBorrowers: firstTime,
        repeatBorrowers: repeat,
        firstTimeBorrowerRatio: firstTimeRatio
      },

      riskIndicators: {
        highRiskLoans,
        loansNearingDueDate: nearingDueDate,
        overdueAmount
      }
    });

  } catch (err) {
    console.error("Loans report error:", err);
    res.status(500).json({ message: err.message });
  }
};


/* ===========================
   REPAYMENTS REPORT
=========================== */
exports.getRepaymentsReport = async (req, res) => {
  try {
    const lenderId = req.user.id; // multi-tenant safe

    /* =====================================================
       1️⃣ BASIC COLLECTION PERFORMANCE
    ===================================================== */

    /* =====================================================
   COLLECTION PERFORMANCE (CORRECT VERSION)
===================================================== */

const loans = await Loan.find({
  lenderId,
  status: { $in: ["active", "overdue", "fully paid"] },
  loanRequestStatus: "approved"
});

const totalLoansIssued = loans.reduce(
  (sum, l) => sum + l.amount,   // principal only
  0
);

const totalCollected = loans.reduce(
  (sum, l) => sum + l.repaidAmount,
  0
);

const collectionRate =
  totalLoansIssued > 0
    ? ((totalCollected / totalLoansIssued) * 100).toFixed(2)
    : 0;

const overdueAmount = loans
  .filter(l => l.status === "overdue")
  .reduce((sum, l) => sum + l.balance, 0);

const missedRepayments = loans.reduce((sum, l) => {
  return (
    sum +
    l.repayments.filter(r => r.wasPaymentLate).length
  );
}, 0);

    /* =====================================================
       2️⃣ REPAYMENT BEHAVIOR
    ===================================================== */

    let totalRepaymentsCount = 0;
    let lateCount = 0;
    let earlyCount = 0;
    let totalDaysLate = 0;

    loans.forEach(loan => {
      loan.repayments.forEach(r => {
        totalRepaymentsCount++;

        if (r.wasPaymentLate) {
          lateCount++;
          totalDaysLate += r.daysLate;
        }

        if (!r.wasPaymentLate && r.daysLate === 0) {
          earlyCount++;
        }
      });
    });

    const onTimePercent =
      totalRepaymentsCount > 0
        ? (((totalRepaymentsCount - lateCount) / totalRepaymentsCount) * 100).toFixed(2)
        : 0;

    const latePercent =
      totalRepaymentsCount > 0
        ? ((lateCount / totalRepaymentsCount) * 100).toFixed(2)
        : 0;

    const averageDaysLate =
      lateCount > 0 ? (totalDaysLate / lateCount).toFixed(1) : 0;

    const earlyRepaymentsPercent =
      totalRepaymentsCount > 0
        ? ((earlyCount / totalRepaymentsCount) * 100).toFixed(2)
        : 0;

  /* =====================================================
   3️⃣ CHANNEL ANALYSIS (FIXED FOR YOUR SCHEMA)
===================================================== */

// Get approved issued loans
const issuedLoans = await Loan.find({
  lenderId,
  status: { $in: ["active", "overdue", "fully paid"] },
  loanRequestStatus: "approved"
}).select("_id");

const loanIds = issuedLoans.map(l => l._id);

// Now fetch repayment transactions for those loans
const transactions = await Transaction.find({
  loanId: { $in: loanIds },
  type: "repayment",
  status: "successful"
});

const totalChannelAmount = transactions.reduce(
  (sum, t) => sum + t.amount,
  0
);

const channelMap = {
  mpesa: 0,
  cash: 0,
  bank_transfer: 0,
  other: 0
};

transactions.forEach(t => {
  // infer mpesa from checkoutRequestID presence
  let method = "other";

  if (t.checkoutRequestID) method = "mpesa";
  if (t.paymentMethod) method = t.paymentMethod.toLowerCase();

  if (channelMap[method] !== undefined) {
    channelMap[method] += t.amount;
  } else {
    channelMap.other += t.amount;
  }
});

const channelAnalysis = Object.keys(channelMap).map(key => ({
  channel: key,
  amount: channelMap[key],
  percentage:
    totalChannelAmount > 0
      ? Number(((channelMap[key] / totalChannelAmount) * 100).toFixed(2))
      : 0
}));
    /* =====================================================
       4️⃣ AGING ANALYSIS
    ===================================================== */

    const today = new Date();

    let aging = {
      current: 0,
      days_1_7: 0,
      days_8_30: 0,
      days_31_90: 0,
      days_90_plus: 0
    };

    loans.forEach(loan => {
      if (loan.balance <= 0) return;

      const diffDays = Math.floor(
        (today - new Date(loan.dueDate)) / (1000 * 60 * 60 * 24)
      );

      if (diffDays <= 0) {
        aging.current += loan.balance;
      } else if (diffDays <= 7) {
        aging.days_1_7 += loan.balance;
      } else if (diffDays <= 30) {
        aging.days_8_30 += loan.balance;
      } else if (diffDays <= 90) {
        aging.days_31_90 += loan.balance;
      } else {
        aging.days_90_plus += loan.balance;
      }
    });

    /* =====================================================
       5️⃣ REPAYMENTS BY AGENT
    ===================================================== */

    const repaymentsByAgent = await Loan.aggregate([
      { $match: { lenderId: new mongoose.Types.ObjectId(lenderId) } },
      { $unwind: "$repayments" },
      {
        $group: {
          _id: "$requestedByAgentId",
          totalCollected: { $sum: "$repayments.amount" },
          count: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: "agents",
          localField: "_id",
          foreignField: "_id",
          as: "agent"
        }
      },
      { $unwind: "$agent" }
    ]);

    /* =====================================================
       FINAL RESPONSE STRUCTURE (MATCH IMAGE)
    ===================================================== */

    res.json({
      success: true,
      collectionPerformance: {
        totalLoansIssued,
        totalCollected,
        collectionRate: Number(collectionRate),
        missedRepayments,
        overdueAmount
      },

      repaymentBehavior: {
        onTimePercent: Number(onTimePercent),
        latePercent: Number(latePercent),
        averageDaysLate: Number(averageDaysLate),
        earlyRepaymentsPercent: Number(earlyRepaymentsPercent)
      },

      channelAnalysis,

      agingAnalysis: aging,

      repaymentsByAgent: repaymentsByAgent.map(a => ({
        agentId: a._id,
        agentName: a.agent.name,
        totalCollected: a.totalCollected,
        repaymentCount: a.count
      }))
    });
  } catch (error) {
    console.error("Repayment Report Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate repayment report"
    });
  }
};

/* ===========================
   PROFIT & INTEREST REPORT
=========================== */
exports.getProfitReport = async (req, res) => {
  try {
    const lenderId = req.user.id;

    /* =====================================================
       BASE LOAN FILTER
    ===================================================== */

    const loans = await Loan.find({
      lenderId,
      loanRequestStatus: "approved",
      status: { $in: ["active", "overdue", "fully paid"] }
    });

    /* =====================================================
       REVENUE METRICS
    ===================================================== */

    const totalPrincipal = loans.reduce(
      (sum, l) => sum + (l.amount || 0),
      0
    );

    const totalInterestExpected = loans.reduce(
      (sum, l) => sum + (l.interest || 0),
      0
    );

    const totalInterestCollected = loans.reduce(
      (sum, l) =>
        sum + Math.max(0, (l.repaidAmount || 0) - (l.amount || 0)),
      0
    );

    /* Fees & Penalties from Transactions */
    const transactions = await Transaction.find({ lenderId });

    const feesCollected = transactions
      .filter(t => t.type === "fee" && t.status === "successful")
      .reduce((sum, t) => sum + t.amount, 0);

    const penaltiesCollected = transactions
      .filter(t => t.type === "penalty" && t.status === "successful")
      .reduce((sum, t) => sum + t.amount, 0);

    /* =====================================================
       PROFITABILITY
    ===================================================== */

    const grossRevenue =
      totalInterestCollected + feesCollected + penaltiesCollected;

    const operationalCostPerLoan = 35; // you can move to config
    const totalOperationalCost =
      loans.length * operationalCostPerLoan;

    const netProfit = grossRevenue - totalOperationalCost;

    /* =====================================================
       EFFICIENCY METRICS
    ===================================================== */

    const uniqueBorrowers = new Set(
      loans.map(l => l.borrowerId?.toString())
    ).size;

    const revenuePerBorrower =
      uniqueBorrowers > 0
        ? Number((grossRevenue / uniqueBorrowers).toFixed(2))
        : 0;

    const uniqueAgents = new Set(
      loans.map(l => l.requestedByAgentId?.toString())
    ).size;

    const revenuePerAgent =
      uniqueAgents > 0
        ? Number((grossRevenue / uniqueAgents).toFixed(2))
        : 0;

    /* =====================================================
       YIELD ON PORTFOLIO
    ===================================================== */

    const yieldOnPortfolio =
      totalPrincipal > 0
        ? Number(
            ((totalInterestCollected / totalPrincipal) * 100).toFixed(2)
          )
        : 0;

    /* =====================================================
       TREND CHARTS (MONTHLY)
    ===================================================== */

    const interestTrend = await Loan.aggregate([
      {
        $match: {
          lenderId: new mongoose.Types.ObjectId(lenderId),
          loanRequestStatus: "approved"
        }
      },
      {
        $group: {
          _id: {
            year: { $year: "$issueDate" },
            month: { $month: "$issueDate" }
          },
          interestExpected: { $sum: "$interest" }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    const profitTrend = await Loan.aggregate([
      {
        $match: {
          lenderId: new mongoose.Types.ObjectId(lenderId),
          loanRequestStatus: "approved"
        }
      },
      {
        $group: {
          _id: {
            year: { $year: "$issueDate" },
            month: { $month: "$issueDate" }
          },
          totalPrincipal: { $sum: "$amount" },
          totalInterest: { $sum: "$interest" }
        }
      }
    ]);

    /* =====================================================
       RESPONSE (MATCHING UI IMAGE)
    ===================================================== */

    res.json({
      success: true,

      revenueMetrics: {
        totalInterestEarned: totalInterestCollected,
        totalInterestExpected,
        feesCollected,
        penaltiesCollected,
        profitabilityAfterExpenses: netProfit
      },

      efficiencyIndicators: {
        costPerLoan: operationalCostPerLoan,
        revenuePerBorrower,
        revenuePerAgent
      },

      profitabilityMetrics: {
        grossProfit: grossRevenue,
        netProfit,
        yieldOnPortfolio
      },

      trendCharts: {
        interestIncomeTrend: interestTrend,
        profitTrend
      }
    });

  } catch (err) {
    console.error("Profit report error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ===========================
   BORROWERS PROFESSIONAL REPORT
=========================== */
exports.getBorrowersReport = async (req, res) => {
  try {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const borrowers = await Customer.find().lean();
    const loans = await Loan.find({
      loanRequestStatus: "approved",
      isDeleted: { $ne: true },
      isWrittenOff: { $ne: true }
    }).lean();

    /* =========================================================
       1️⃣ BORROWER BASE METRICS
    ========================================================= */

    const totalRegisteredBorrowers = borrowers.length;

    const activeBorrowerIds = new Set(
      loans.filter(l => l.status === "active")
           .map(l => l.borrowerId.toString())
    );

    const activeBorrowers = activeBorrowerIds.size;

    const newBorrowers = borrowers.filter(
      b => new Date(b.createdAt) >= startOfMonth
    );

    const repeatBorrowerMap = {};
    loans.forEach(l => {
      const id = l.borrowerId.toString();
      repeatBorrowerMap[id] = (repeatBorrowerMap[id] || 0) + 1;
    });

    const repeatBorrowers = Object.values(repeatBorrowerMap)
      .filter(c => c > 1).length;

    const currentlyRepaying = loans.filter(
      l => l.status === "active"
    ).length;

    /* =========================================================
       2️⃣ CREDIT BEHAVIOR
    ========================================================= */

    const averageLoansPerBorrower =
      totalRegisteredBorrowers > 0
        ? Number((loans.length / totalRegisteredBorrowers).toFixed(2))
        : 0;

    const totalExpected = loans.reduce(
      (sum, l) => sum + (l.totalRepayment || 0),
      0
    );

    const totalCollected = loans.reduce(
      (sum, l) => sum + (l.repaidAmount || 0),
      0
    );

    const repaymentPercentage =
      totalExpected > 0
        ? Number(((totalCollected / totalExpected) * 100).toFixed(2))
        : 0;

    const borrowerRepaymentScore =
      Number((repaymentPercentage / 10).toFixed(1)); // 0–10 scale

    /* ---------------- TOP GOOD PAYERS ---------------- */

    const borrowerCollectedMap = {};

    loans.forEach(l => {
      const id = l.borrowerId.toString();
      borrowerCollectedMap[id] =
        (borrowerCollectedMap[id] || 0) +
        (l.repaidAmount || 0);
    });

    const topGoodPayers = Object.entries(borrowerCollectedMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, amount]) => {
        const borrower = borrowers.find(
          b => b._id.toString() === id
        );
        return {
          name: borrower?.fullName || "Unknown",
          totalPaid: amount
        };
      });

    /* ---------------- TOP DEFAULTERS ---------------- */

    const defaultedBorrowers = loans
      .filter(l => l.isDefaulted)
      .map(l => l.borrowerId.toString());

    const defaulterCounts = {};

    defaultedBorrowers.forEach(id => {
      defaulterCounts[id] = (defaulterCounts[id] || 0) + 1;
    });

    const topDefaulters = Object.entries(defaulterCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => {
        const borrower = borrowers.find(
          b => b._id.toString() === id
        );
        return {
          name: borrower?.fullName || "Unknown",
          defaultCount: count
        };
      });

    /* =========================================================
       3️⃣ SEGMENTATION
    ========================================================= */

    const segmentation = {
      borrowersByGender: {},
      borrowersByBusinessType: {},
      borrowersByRegion: {},
      borrowersByRiskLevel: {
        veryLow: 0,
        low: 0,
        moderate: 0,
        high: 0
      }
    };

    borrowers.forEach(b => {
      segmentation.borrowersByGender[b.gender || "Unknown"] =
        (segmentation.borrowersByGender[b.gender || "Unknown"] || 0) + 1;

      segmentation.borrowersByBusinessType[b.businessType || "Unknown"] =
        (segmentation.borrowersByBusinessType[b.businessType || "Unknown"] || 0) + 1;

      segmentation.borrowersByRegion[b.region || "Unknown"] =
        (segmentation.borrowersByRegion[b.region || "Unknown"] || 0) + 1;

      const score = b.creditScore || 500;

      if (score >= 750) segmentation.borrowersByRiskLevel.veryLow++;
      else if (score >= 650) segmentation.borrowersByRiskLevel.low++;
      else if (score >= 550) segmentation.borrowersByRiskLevel.moderate++;
      else segmentation.borrowersByRiskLevel.high++;
    });

    /* =========================================================
       4️⃣ LIFECYCLE INSIGHTS
    ========================================================= */

    const firstTimeBorrowers =
      Object.values(repeatBorrowerMap).filter(c => c === 1).length;

    const borrowerRetentionRate =
      totalRegisteredBorrowers > 0
        ? Number(
            ((repeatBorrowers / totalRegisteredBorrowers) * 100).toFixed(2)
          )
        : 0;

    const dormantBorrowers = borrowers.filter(b => {
      const borrowerLoans = loans.filter(
        l => l.borrowerId.toString() === b._id.toString()
      );
      if (!borrowerLoans.length) return true;

      const latestLoan = borrowerLoans.sort(
        (a, b2) => new Date(b2.createdAt) - new Date(a.createdAt)
      )[0];

      const daysSinceLastLoan =
        (today - new Date(latestLoan.createdAt)) /
        (1000 * 60 * 60 * 24);

      return daysSinceLastLoan > 90;
    }).length;

    /* =========================================================
       FINAL RESPONSE (UI MATCH)
    ========================================================= */

    res.json({
      success: true,
      borrowerBaseMetrics: {
        totalRegisteredBorrowers,
        thisPeriodNewBorrowers: newBorrowers.length,
        activeBorrowers,
        newBorrowers: newBorrowers.length,
        repeatBorrowers,
        currentlyRepaying
      },
      creditBehavior: {
        averageLoansPerBorrower,
        borrowerRepaymentScore,
        repaymentPercentage,
        topGoodPayers,
        topDefaulters
      },
      segmentation,
      lifecycleInsights: {
        firstTimeBorrowers,
        repeatBorrowers,
        borrowerRetentionRate,
        dormantBorrowers
      }
    });

  } catch (error) {
    console.error("Borrower report error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* ===========================
   AGENTS REPORT
=========================== */
exports.getAgentsReport = async (req, res) => {
  try {
    const lenderId = req.user._id;
    const today = new Date();

    const agents = await Agent.find({ lenderId })
      .select("-password")
      .lean();

    let summary = {
      totalRegisteredBorrowers: 0,
      newBorrowers: 0,
      repeatBorrowers: 0,
      totalDisbursed: 0,
      totalCollected: 0,
      currentlyRepaying: 0
    };

    const portfolioQualityByAgent = [];
    const operationalBehavior = [];
    const leaderboardData = [];

    for (const agent of agents) {

      /* ===================================================
         GET LOANS CREATED BY AGENT
      =================================================== */

      const loans = await Loan.find({
        lenderId,
        requestedByAgentId: agent._id,
        loanRequestStatus: "approved"
      }).lean();

      const loansHandled = loans.length;

      const totalDisbursed = loans.reduce(
        (sum, loan) => sum + (loan.amount || 0),
        0
      );

      /* ===================================================
         COLLECTION (FROM EMBEDDED REPAYMENTS)
      =================================================== */

      let totalCollected = 0;

      loans.forEach(loan => {
        if (loan.repayments && loan.repayments.length > 0) {
          loan.repayments.forEach(r => {
            if (r.status === "successful") {
              totalCollected += r.amount || 0;
            }
          });
        }
      });

      /* ===================================================
         BORROWER ANALYSIS (FROM LOANS)
      =================================================== */

      const borrowerIds = loans.map(l => l.borrowerId?.toString());

      const uniqueBorrowers = [...new Set(borrowerIds)];

      const totalBorrowersForAgent = uniqueBorrowers.length;

      const repeatBorrowers = borrowerIds.length - uniqueBorrowers.length;

      /* ===================================================
         ACTIVE LOANS
      =================================================== */

      const activeLoans = loans.filter(
        l => l.loanStatus === "active"
      );

      const currentlyRepaying = activeLoans.length;

      /* ===================================================
         PORTFOLIO QUALITY
      =================================================== */

      const overdueLoans = loans.filter(
        l =>
          l.loanStatus === "active" &&
          l.nextDueDate &&
          new Date(l.nextDueDate) < today
      );

      const overdueAmount = overdueLoans.reduce(
        (sum, l) => sum + (l.outstandingBalance || 0),
        0
      );

      const par =
        totalDisbursed > 0
          ? (overdueAmount / totalDisbursed) * 100
          : 0;

      const defaultedLoans = loans.filter(
        l => l.loanStatus === "defaulted"
      );

      const defaultRate =
        loansHandled > 0
          ? (defaultedLoans.length / loansHandled) * 100
          : 0;

      const collectionEfficiency =
        totalDisbursed > 0
          ? (totalCollected / totalDisbursed) * 100
          : 0;

      /* ===================================================
         RISK FLAGS
      =================================================== */

      const riskFlags = [];

      if (totalDisbursed > 100000 && totalCollected < totalDisbursed * 0.3)
        riskFlags.push("HIGH_DISBURSE_LOW_COLLECTION");

      if (par > 20)
        riskFlags.push("HIGH_PAR");

      if (defaultRate > 15)
        riskFlags.push("HIGH_DEFAULT_RATE");

      if (repeatBorrowers > 5)
        riskFlags.push("REPEATED_BORROWER_PATTERN");

      /* ===================================================
         PUSH AGENT DATA
      =================================================== */

      portfolioQualityByAgent.push({
  agentName: agent.name,
  par: Number(par.toFixed(2)),
  defaultRate: Number(defaultRate.toFixed(2)),
  overdueAmount,
  collectionEfficiency: Number(collectionEfficiency.toFixed(2))
});

    operationalBehavior.push({
  agentName: agent.name,
  lastActivity: agent.lastActiveAt || null,
  riskFlags
});

      leaderboardData.push({
  agentName: agent.name,
  score: collectionEfficiency - par - defaultRate,
  riskFlags
});

      /* ===================================================
         UPDATE SUMMARY
      =================================================== */

      summary.totalRegisteredBorrowers += totalBorrowersForAgent;
      summary.repeatBorrowers += repeatBorrowers;
      summary.totalDisbursed += totalDisbursed;
      summary.totalCollected += totalCollected;
      summary.currentlyRepaying += currentlyRepaying;
    }

    /* ===================================================
       LEADERBOARDS
    =================================================== */

    const topPerforming = [...leaderboardData]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const underPerforming = [...leaderboardData]
      .sort((a, b) => a.score - b.score)
      .slice(0, 3);

    const highRiskAgents = leaderboardData.filter(
      a => a.riskFlags.length > 0
    );

    /* ===================================================
       RESPONSE
    =================================================== */

    return res.json({
      success: true,
      summary,
      portfolioQualityByAgent,
      operationalBehavior,
      leaderboards: {
        topPerforming,
        underPerforming,
        highRiskAgents
      }
    });

  } catch (error) {
    console.error("Agent Report Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate agent report",
      error: error.message
    });
  }
};


/* ===========================
   AUDIT LOGS (BASIC)
=========================== */
exports.getAuditLogs = async (req, res) => {
  res.json({
    success: true,
    data: [] // extend later
  });
};


/* =====================================================
   LOAN & REPAYMENT REPORT (DATE RANGE)
   ❗ NEW API – DOES NOT CHANGE EXISTING CODE
===================================================== */
exports.getLoanRepaymentReport = async (req, res) => {
  try {
    const { borrowerId, loanId, fromDate, toDate } = req.query;

    // 🔹 Build filter (EMPTY = ALL BORROWERS)
    const loanFilter = {};

    if (borrowerId) {
      loanFilter.borrowerId = borrowerId;
    }

    if (loanId) {
      loanFilter._id = loanId;
    }

    if (fromDate || toDate) {
      loanFilter.createdAt = {};
      if (fromDate) loanFilter.createdAt.$gte = new Date(fromDate);
      if (toDate) loanFilter.createdAt.$lte = new Date(toDate);
    }

    // 🔹 Fetch loans for ALL borrowers
    const loans = await Loan.find(loanFilter)
      .populate("borrowerId", "fullName phone")
      .populate("lenderId", "fullName phone");

    let totalPrincipal = 0;
    let totalInterest = 0;
    let totalPaid = 0;
    let totalBalance = 0;

    const reportData = loans.map((loan) => {
      const paidAmount = Array.isArray(loan.repayments)
        ? loan.repayments.reduce((sum, r) => sum + (r.amount || 0), 0)
        : 0;

      totalPrincipal += loan.amount || 0;
      totalInterest += loan.interest || 0;
      totalPaid += paidAmount;
      totalBalance += loan.balance || 0;

      return {
        loanId: loan._id,
        borrowerId: loan.borrowerId?._id || null,
        borrowerName: loan.borrowerId?.fullName || "N/A",
        borrowerPhone: loan.borrowerId?.phone || "N/A",
        principalAmount: loan.amount,
        interestAmount: loan.interest,
        totalRepayment: loan.totalRepayment,
        paidAmount,
        outstandingBalance: loan.balance,
        status: loan.status,
        issueDate: loan.issueDate,
        dueDate: loan.dueDate
      };
    });

    return res.status(200).json({
      success: true,
      filtersApplied: {
        borrowerId: borrowerId || "ALL",
        loanId: loanId || "ALL",
        fromDate: fromDate || null,
        toDate: toDate || null
      },
      summary: {
        totalLoans: reportData.length,
        totalPrincipal,
        totalInterest,
        totalPaid,
        totalOutstandingBalance: totalBalance
      },
      data: reportData
    });

  } catch (error) {
    console.error("❌ Loan repayment report error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};


/* ===========================
   MARITAL STATUS REPORT
=========================== */
exports.getMaritalStatusReport = async (req, res) => {
  try {
    const data = await Customer.aggregate([
      {
        $group: {
          _id: "$maritalStatus",
          value: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          label: "$_id",
          value: 1
        }
      }
    ]);

    res.json({
      success: true,
      count: data.length,
      data
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ===========================
   LOAN AMOUNT BY BUSINESS TYPE
== ======================== */
exports.getBusinessTypeLoanReport = async (req, res) => {
  try {
    const lenderId = req.user._id;
    const today = new Date();

    /* ================= FETCH DATA ================= */

    const loans = await Loan.find({
      lenderId,
      loanRequestStatus: "approved"
    }).lean();

    const customers = await Customer.find().lean();

    const businessMap = {};

    /* ================= PROCESS LOANS ================= */

    for (const loan of loans) {

      const borrower = customers.find(
        c => c._id.toString() === loan.borrowerId.toString()
      );

      if (!borrower) continue;

      const businessType =
        borrower.occupation
          ? borrower.occupation.trim()
          : "Others";

      if (!businessMap[businessType]) {
        businessMap[businessType] = {
          numberOfLoansIssued: 0,
          totalDisbursedAmount: 0,
          activeLoans: 0,
          completedLoans: 0,
          defaultedLoans: 0,
          restructuredLoans: 0,

          totalRepaid: 0,
          totalExpected: 0,

          onTimeRepayments: 0,
          lateRepayments: 0,
          totalDaysLate: 0,

          partialRepayments: 0,
          fullRepayments: 0,

          overdueAmount: 0,
          loansNearingDueDate: 0,

          maritalStatusDistribution: {},
          educationLevelDistribution: {},
          householdSizeDistribution: {
            small: 0,
            medium: 0,
            large: 0
          },
          urbanRuralSplit: {
            urban: 0,
            rural: 0
          }
        };
      }

      const b = businessMap[businessType];

      /* ===== LOAN METRICS ===== */

      b.numberOfLoansIssued++;
      b.totalDisbursedAmount += loan.amount || 0;
      b.totalExpected += loan.totalRepayment || 0;

      if (loan.status === "active") b.activeLoans++;
      if (loan.status === "fully paid") b.completedLoans++;
      if (loan.isDefaulted) b.defaultedLoans++;

      /* ===== REPAYMENT LOGIC ===== */

      let actualRepaid = 0;

      if (Array.isArray(loan.repayments) && loan.repayments.length > 0) {
        for (const r of loan.repayments) {
          actualRepaid += r.amount || 0;

          if (r.wasPaymentLate) {
            b.lateRepayments++;
            b.totalDaysLate += r.daysLate || 0;
          } else {
            b.onTimeRepayments++;
          }
        }
      }

      if (actualRepaid === 0 && loan.repaidAmount > 0) {
        actualRepaid = loan.repaidAmount;
      }

      b.totalRepaid += actualRepaid;

      if (actualRepaid > 0 && actualRepaid < loan.totalRepayment)
        b.partialRepayments++;

      if (actualRepaid >= loan.totalRepayment)
        b.fullRepayments++;

      /* ===== PAR ===== */

      if (loan.status === "overdue") {
        b.overdueAmount += loan.balance || 0;
      }

      /* ===== NEARING DUE ===== */

      const daysToDue =
        (new Date(loan.dueDate) - today) /
        (1000 * 60 * 60 * 24);

      if (daysToDue >= 0 && daysToDue <= 7)
        b.loansNearingDueDate++;

      /* ===== DEMOGRAPHICS ===== */

      const marital = borrower.maritalStatus || "Unknown";
      b.maritalStatusDistribution[marital] =
        (b.maritalStatusDistribution[marital] || 0) + 1;

      const edu = borrower.educationLevel || "Unknown";
      b.educationLevelDistribution[edu] =
        (b.educationLevelDistribution[edu] || 0) + 1;

      const size = borrower.householdSize || 0;
      if (size <= 2) b.householdSizeDistribution.small++;
      else if (size <= 5) b.householdSizeDistribution.medium++;
      else b.householdSizeDistribution.large++;

      if (borrower.physicalAddress &&
          borrower.physicalAddress.toLowerCase().includes("nairobi"))
        b.urbanRuralSplit.urban++;
      else
        b.urbanRuralSplit.rural++;
    }

    /* ================= FORMAT RESPONSE ================= */

    const businessTypeReport = Object.keys(businessMap).map(type => {

      const b = businessMap[type];

      const averageLoanSize =
        b.numberOfLoansIssued > 0
          ? Number(
              (b.totalDisbursedAmount /
               b.numberOfLoansIssued).toFixed(2)
            )
          : 0;

      const repaymentRate =
        b.totalExpected > 0
          ? Number(
              ((b.totalRepaid /
                b.totalExpected) * 100).toFixed(2)
            )
          : 0;

      const averageDaysLate =
        b.lateRepayments > 0
          ? Number(
              (b.totalDaysLate /
               b.lateRepayments).toFixed(1)
            )
          : 0;

      const defaultRate =
        b.numberOfLoansIssued > 0
          ? Number(
              ((b.defaultedLoans /
                b.numberOfLoansIssued) * 100).toFixed(2)
            )
          : 0;

      const parPercentage =
        b.totalDisbursedAmount > 0
          ? Number(
              ((b.overdueAmount /
                b.totalDisbursedAmount) * 100).toFixed(2)
            )
          : 0;

      return {
        businessType: type,

        loanMetricsByBusinessType: {
          numberOfLoansIssued: b.numberOfLoansIssued,
          totalDisbursedAmount: b.totalDisbursedAmount,
          averageLoanSize,
          activeLoans: b.activeLoans,
          completedLoans: b.completedLoans,
          defaultedLoans: b.defaultedLoans,
          restructuredLoans: b.restructuredLoans
        },

        borrowerBehavior: {
          repaymentRatePerBusinessType: repaymentRate,
          onTimeRepayments: b.onTimeRepayments,
          lateRepayments: b.lateRepayments,
          averageDaysLate,
          partialRepayments: b.partialRepayments,
          fullRepayments: b.fullRepayments
        },

        riskIndicators: {
          highPARPercentage: parPercentage,
          defaultRateByBusinessType: defaultRate,
          loansNearingDueDate: b.loansNearingDueDate
        },

        demographicOverlays: {
          maritalStatusDistribution: b.maritalStatusDistribution,
          educationLevelDistribution: b.educationLevelDistribution,
          householdSizeDistribution: b.householdSizeDistribution,
          urbanRuralSplit: b.urbanRuralSplit
        }
      };
    });

    return res.json({
      success: true,
      businessTypeReport
    });

  } catch (error) {
    console.error("Business type report error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate business type report"
    });
  }
};

/* ===========================
   REPAYMENT PERCENTAGE BY REGION
=========================== */
exports.getRegionalRepaymentReport = async (req, res) => {
  try {

    // Phone prefix → Country code map
    const phoneCountryMap = {
      "254": "KE",
      "256": "UG",
      "234": "NG",
      "91": "IN",
      "250": "RW",
      "255": "TZ"
    };

    const data = await Loan.aggregate([
      {
        $lookup: {
          from: "customers",
          localField: "borrowerId",
          foreignField: "_id",
          as: "borrower"
        }
      },
      { $unwind: "$borrower" },

      // Extract phone digits without "+"
      {
        $addFields: {
          phoneDigits: {
            $replaceAll: {
              input: "$borrower.phone",
              find: "+",
              replacement: ""
            }
          }
        }
      },

      // Extract first 3 digits
      {
        $addFields: {
          countryCode: {
            $substr: ["$phoneDigits", 0, 3]
          }
        }
      },

      {
        $group: {
          _id: "$countryCode",
          totalLoan: { $sum: "$amount" },
          totalRepaid: { $sum: "$repaidAmount" }
        }
      }
    ]);

    // Calculate percent + map country code
    const formatted = data.map(item => {

      const percent =
        item.totalLoan === 0
          ? 0
          : Math.round((item.totalRepaid / item.totalLoan) * 100);

      return {
        region: phoneCountryMap[item._id] || item._id,
        percent
      };
    });

    res.json({
      success: true,
      data: formatted
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getRegionPerformanceReport = async (req, res) => {
  try {
    const lenderId = req.user._id;
    const today = new Date();

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);

    /* ================= GET AGENTS ================= */

    const agents = await Agent.find({ lenderId }).select("_id").lean();
    const agentIds = agents.map(a => a._id);

    /* ================= GET CUSTOMERS (LENDER + AGENT CREATED) ================= */

    const customers = await Customer.find({
      isDeleted: false,
      $or: [
        { registeredBy: lenderId, registeredByModel: "User" },
        { registeredBy: { $in: agentIds }, registeredByModel: "Agent" }
      ]
    }).lean();

    /* ================= REGION DETECTION ================= */

 function getRegion(customer) {

  const phone = customer.phone || customer.phoneNumber;

  if (!phone) return "Unknown";

  const p = phone.replace(/\s+/g, "");

  /* ================= KENYA ================= */

  if (p.startsWith("+25470") || p.startsWith("+25471"))
    return "Kenya - Nairobi";

  if (p.startsWith("+25472") || p.startsWith("+25473"))
    return "Kenya - Mombasa";

  if (p.startsWith("+25474") || p.startsWith("+25475"))
    return "Kenya - Kisumu";

  if (p.startsWith("+25476"))
    return "Kenya - Nakuru";

  if (p.startsWith("+25477") || p.startsWith("+25478"))
    return "Kenya - Eldoret";

  if (p.startsWith("+25479"))
    return "Kenya - Thika";


  /* ================= UGANDA ================= */

  if (p.startsWith("+25670") || p.startsWith("+25675"))
    return "Uganda - Kampala";

  if (p.startsWith("+25677"))
    return "Uganda - Entebbe";

  if (p.startsWith("+25678"))
    return "Uganda - Jinja";

  if (p.startsWith("+25674"))
    return "Uganda - Gulu";

  if (p.startsWith("+25676"))
    return "Uganda - Mbale";


  /* ================= TANZANIA ================= */

  if (p.startsWith("+25571") || p.startsWith("+25575"))
    return "Tanzania - Dar es Salaam";

  if (p.startsWith("+25576"))
    return "Tanzania - Arusha";

  if (p.startsWith("+25573"))
    return "Tanzania - Mwanza";

  if (p.startsWith("+25574"))
    return "Tanzania - Dodoma";

  if (p.startsWith("+25578"))
    return "Tanzania - Zanzibar";


  /* ================= RWANDA ================= */

  if (p.startsWith("+25078"))
    return "Rwanda - Kigali";

  if (p.startsWith("+25072"))
    return "Rwanda - Butare";

  if (p.startsWith("+25073"))
    return "Rwanda - Gisenyi";

  if (p.startsWith("+25079"))
    return "Rwanda - Ruhengeri";


  /* ================= NIGERIA ================= */

  if (p.startsWith("+23470") || p.startsWith("+23480"))
    return "Nigeria - Lagos";

  if (p.startsWith("+23481"))
    return "Nigeria - Abuja";

  if (p.startsWith("+23490"))
    return "Nigeria - Port Harcourt";

  if (p.startsWith("+23491"))
    return "Nigeria - Kano";

  if (p.startsWith("+23492"))
    return "Nigeria - Ibadan";


  /* ================= GHANA ================= */

  if (p.startsWith("+23324") || p.startsWith("+23354"))
    return "Ghana - Accra";

  if (p.startsWith("+23320"))
    return "Ghana - Kumasi";

  if (p.startsWith("+23327"))
    return "Ghana - Tamale";

  if (p.startsWith("+23326"))
    return "Ghana - Takoradi";

  if (p.startsWith("+23328"))
    return "Ghana - Cape Coast";


  return "Other";
}

    /* ================= GET LOANS ================= */

    const loans = await Loan.find({
      lenderId,
      loanRequestStatus: "approved"
    }).lean();

    /* ================= BUILD REGION MAP ================= */

    const regionMap = {};

    customers.forEach(customer => {
      const region = getRegion(customer);

      if (!regionMap[region]) {
        regionMap[region] = {
          borrowers: new Set(),
          agents: new Set(),
          totalDisbursed: 0,
          activeLoans: 0,
          outstandingBalance: 0,
          collections: 0,
          overdueAmount: 0,
          totalLoans: 0,
          defaultedLoans: 0,
          currentMonthLoans: 0,
          previousMonthLoans: 0
        };
      }

      regionMap[region].borrowers.add(customer._id.toString());
    });

    /* ================= PROCESS LOANS ================= */

    loans.forEach(loan => {
      const customer = customers.find(
        c => c._id.toString() === loan.borrowerId.toString()
      );

      if (!customer) return;

      const region = getRegion(customer);
      const regionData = regionMap[region];

      regionData.totalDisbursed += loan.amount || 0;
      regionData.outstandingBalance += loan.balance || 0;
      regionData.collections += loan.repaidAmount || 0;
      regionData.totalLoans++;

      if (loan.status === "active") regionData.activeLoans++;

      if (loan.status === "overdue") {
        regionData.overdueAmount += loan.balance || 0;
      }

      if (loan.isDefaulted) regionData.defaultedLoans++;

      if (loan.issueDate >= startOfMonth) {
        regionData.currentMonthLoans++;
      }

      if (
        loan.issueDate >= startOfLastMonth &&
        loan.issueDate <= endOfLastMonth
      ) {
        regionData.previousMonthLoans++;
      }

      if (loan.requestedByAgentId) {
        regionData.agents.add(loan.requestedByAgentId.toString());
      }
    });

    /* ================= BUILD FINAL RESPONSE ARRAYS ================= */

    const regionalPortfolioMetrics = [];
    const riskHeatmap = [];
    const operationalEfficiency = [];
    const mapHeatView = [];
    const growthArray = [];

    Object.keys(regionMap).forEach(region => {
      const r = regionMap[region];

      const parByRegion =
        r.totalDisbursed > 0
          ? Number(((r.overdueAmount / r.totalDisbursed) * 100).toFixed(2))
          : 0;

      const defaultRateByRegion =
        r.totalLoans > 0
          ? Number(((r.defaultedLoans / r.totalLoans) * 100).toFixed(2))
          : 0;

      const collectionEfficiencyPerRegion =
        r.totalDisbursed > 0
          ? Number(((r.collections / r.totalDisbursed) * 100).toFixed(2))
          : 0;

      /* ===== FIXED HEAT SCORE ===== */

      let heatScore = 0;

      if (r.totalDisbursed > 0) {
        heatScore = Number(
          (
            parByRegion * 0.5 +
            defaultRateByRegion * 0.3 +
            (100 - collectionEfficiencyPerRegion) * 0.2
          ).toFixed(2)
        );
      }

      let riskLevel = "Low";
      if (heatScore > 30) riskLevel = "Critical";
      else if (heatScore > 20) riskLevel = "High";
      else if (heatScore > 10) riskLevel = "Medium";

      /* ===== GROWTH ===== */

      const growthRate =
        r.previousMonthLoans > 0
          ? Number(
              (
                ((r.currentMonthLoans - r.previousMonthLoans) /
                  r.previousMonthLoans) *
                100
              ).toFixed(2)
            )
          : r.currentMonthLoans > 0
          ? 100
          : 0;

      regionalPortfolioMetrics.push({
        region,
        totalDisbursedPerRegion: r.totalDisbursed,
        activeLoansPerRegion: r.activeLoans,
        outstandingBalancePerRegion: r.outstandingBalance,
        collectionsPerRegion: r.collections
      });

      riskHeatmap.push({
        region,
        parByRegion,
        defaultRateByRegion,
        overdueConcentration: r.overdueAmount,
        heatScore
      });

      operationalEfficiency.push({
        region,
        agentsPerRegion: r.agents.size,
        revenuePerRegion: r.collections,
        collectionEfficiencyPerRegion
      });

      mapHeatView.push({
        region,
        heatScore,
        riskLevel
      });

      growthArray.push({
        region,
        growthRate,
        currentMonthLoans: r.currentMonthLoans
      });
    });

    const fastestGrowingRegions = growthArray
      .filter(g => g.growthRate > 0)
      .sort((a, b) => b.growthRate - a.growthRate)
      .slice(0, 3);

    const decliningRegions = growthArray
      .filter(g => g.growthRate < 0)
      .sort((a, b) => a.growthRate - b.growthRate)
      .slice(0, 3);

    const newMarketPerformance = growthArray.filter(
      g => g.currentMonthLoans > 0 && g.growthRate === 100
    );

    return res.json({
      success: true,
      regionalPortfolioMetrics,
      riskHeatmap,
      growthIndicators: {
        fastestGrowingRegions,
        decliningRegions,
        newMarketPerformance
      },
      operationalEfficiency,
      mapHeatView
    });

  } catch (error) {
    console.error("Region performance error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate regional performance report"
    });
  }
};

/* ===========================
   PROFIT & INTEREST DETAILED REPORT
=========================== */
exports.getDetailedProfitReport = async (req, res) => {
  try {
    const lenderId = req.user.id;

    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;

    /* =====================================================
       BASE LOANS (ISSUED ONLY)
    ===================================================== */

    const loanFilter = {
      lenderId,
      loanRequestStatus: "approved",
      status: { $in: ["active", "overdue", "fully paid"] }
    };

    const loans = await Loan.find(loanFilter);

    const totalLoans = loans.length;

    /* =====================================================
       REVENUE CALCULATIONS
    ===================================================== */

    const totalPrincipal = loans.reduce(
      (sum, l) => sum + (l.amount || 0),
      0
    );

    const totalInterestExpected = loans.reduce(
      (sum, l) => sum + (l.interest || 0),
      0
    );

    const totalInterestCollected = loans.reduce(
      (sum, l) =>
        sum + Math.max(0, (l.repaidAmount || 0) - (l.amount || 0)),
      0
    );

    /* =====================================================
       PERIOD INTEREST (Collected)
    ===================================================== */

    let interestThisPeriod = 0;

    if (from && to) {
      loans.forEach(l => {
        if (l.updatedAt >= from && l.updatedAt <= to) {
          const collected = Math.max(
            0,
            (l.repaidAmount || 0) - (l.amount || 0)
          );
          interestThisPeriod += collected;
        }
      });
    }

    /* =====================================================
       FEES & PENALTIES
    ===================================================== */

    const transactionFilter = { lenderId };

    if (from && to) {
      transactionFilter.createdAt = { $gte: from, $lte: to };
    }

    const transactions = await Transaction.find(transactionFilter);

    const feesCollected = transactions
      .filter(t => t.type === "fee" && t.status === "successful")
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    const penaltiesCollected = transactions
      .filter(t => t.type === "penalty" && t.status === "successful")
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    /* =====================================================
       PROFITABILITY
    ===================================================== */

    const grossProfit =
      totalInterestCollected + feesCollected + penaltiesCollected;

    const netProfit = grossProfit; // no artificial cost

    const yieldOnPortfolio =
      totalPrincipal > 0
        ? Number(
            ((totalInterestCollected / totalPrincipal) * 100).toFixed(2)
          )
        : 0;

    const averageInterestPerLoan =
      totalLoans > 0
        ? Number((totalInterestCollected / totalLoans).toFixed(2))
        : 0;

    /* =====================================================
       EFFICIENCY
    ===================================================== */

    const uniqueBorrowers = new Set(
      loans.map(l => l.borrowerId?.toString())
    ).size;

    const revenuePerBorrower =
      uniqueBorrowers > 0
        ? Number((grossProfit / uniqueBorrowers).toFixed(2))
        : 0;

    const uniqueAgents = new Set(
      loans.map(l => l.requestedByAgentId?.toString())
    ).size;

    const revenuePerAgent =
      uniqueAgents > 0
        ? Number((grossProfit / uniqueAgents).toFixed(2))
        : 0;

    /* =====================================================
       TREND CHARTS (MONTHLY)
    ===================================================== */

    const trendMatch = {
      lenderId: new mongoose.Types.ObjectId(lenderId),
      loanRequestStatus: "approved"
    };

    const interestTrend = await Loan.aggregate([
      { $match: trendMatch },
      {
        $group: {
          _id: {
            year: { $year: "$issueDate" },
            month: { $month: "$issueDate" }
          },
          interestExpected: { $sum: "$interest" },
          interestCollected: {
            $sum: {
              $max: [
                { $subtract: ["$repaidAmount", "$amount"] },
                0
              ]
            }
          },
          principal: { $sum: "$amount" }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    const profitTrend = interestTrend.map(t => ({
      year: t._id.year,
      month: t._id.month,
      grossProfit: t.interestCollected
    }));

    const yieldTrend = interestTrend.map(t => ({
      year: t._id.year,
      month: t._id.month,
      yield:
        t.principal > 0
          ? Number(
              ((t.interestCollected / t.principal) * 100).toFixed(2)
            )
          : 0
    }));

    /* =====================================================
       RESPONSE
    ===================================================== */

    res.json({
  success: true,

  revenueMetrics: {
    totalInterestEarned: totalInterestCollected,
    interestEarnedThisPeriod: interestThisPeriod,
    totalInterestExpected,
    feesCollected,
    penaltiesCollected
  },

  profitabilityMetrics: {
    grossProfit,
    netProfit,
    yieldOnPortfolio,
    averageInterestPerLoan
  },

  efficiencyIndicators: {
    costPerLoan: 0, // set real value if expense module exists
    revenuePerBorrower,
    revenuePerAgent
  },

  trendCharts: {
    interestIncomeTrend: interestTrend.map(t => ({
      year: t._id.year,
      month: t._id.month,
      expected: t.interestExpected,
      collected: t.interestCollected
    })),

    profitTrend: interestTrend.map(t => ({
      year: t._id.year,
      month: t._id.month,
      profit: t.interestCollected
    })),

    yieldTrend: interestTrend.map(t => ({
      year: t._id.year,
      month: t._id.month,
      yield:
        t.principal > 0
          ? Number(
              ((t.interestCollected / t.principal) * 100).toFixed(2)
            )
          : 0
    }))
  }
});

  } catch (err) {
    console.error("Detailed profit report error:", err);
    res.status(500).json({ message: err.message });
  }
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    


exports.getDemographicsAnalysis = async (req, res) => {
  try {
    const lenderId = req.user._id;
    const today = new Date();

    /* =====================================================
       1️⃣ GET ALL AGENTS UNDER THIS LENDER
    ===================================================== */

    const agents = await Agent.find({ lenderId }).select("_id");
    const agentIds = agents.map(a => a._id);

    /* =====================================================
       2️⃣ GET ALL BORROWERS (LENDER + AGENT CREATED)
    ===================================================== */

    const borrowers = await Customer.find({
      // $or: [
      //   { registeredBy: lenderId, registeredByModel: "User" },
      //   { registeredBy: { $in: agentIds }, registeredByModel: "Agent" }
      // ],
      isDeleted: { $ne: true }
    }).lean();

    /* =====================================================
       3️⃣ GET LOANS FOR THIS LENDER
    ===================================================== */

    const loans = await Loan.find({
      lenderId,
      loanRequestStatus: "approved",
      isDeleted: { $ne: true }
    }).lean();

    /* =====================================================
       4️⃣ BORROWER → LOAN MAP
    ===================================================== */

    const borrowerLoanMap = {};

    loans.forEach(l => {
      const id = l.borrowerId.toString();

      if (!borrowerLoanMap[id]) {
        borrowerLoanMap[id] = {
          totalLoans: 0,
          totalAmount: 0,
          totalRepaid: 0,
          defaulted: 0
        };
      }

      borrowerLoanMap[id].totalLoans++;
      borrowerLoanMap[id].totalAmount += l.amount || 0;
      borrowerLoanMap[id].totalRepaid += l.repaidAmount || 0;

      if (l.isDefaulted) borrowerLoanMap[id].defaulted++;
    });

    /* =====================================================
       5️⃣ BASE DEMOGRAPHICS
    ===================================================== */

    const ageDistribution = {
      under25: 0,
      age25_34: 0,
      age35_44: 0,
      age45_54: 0,
      above55: 0
    };

    const genderDistribution = {};
    const occupationDistribution = {};
    const incomeBands = {};
    const regionMap = {};

    borrowers.forEach(b => {

      // AGE
      if (b.dateOfBirth) {
        const age =
          (today - new Date(b.dateOfBirth)) /
          (1000 * 60 * 60 * 24 * 365);

        if (age < 25) ageDistribution.under25++;
        else if (age < 35) ageDistribution.age25_34++;
        else if (age < 45) ageDistribution.age35_44++;
        else if (age < 55) ageDistribution.age45_54++;
        else ageDistribution.above55++;
      }

      // GENDER
      const gender = b.gender || "Unknown";
      genderDistribution[gender] =
        (genderDistribution[gender] || 0) + 1;

      // OCCUPATION
      const occ = b.occupation || "Unknown";
      occupationDistribution[occ] =
        (occupationDistribution[occ] || 0) + 1;

      // INCOME
      const band = b.monthlyIncomeRange || "Unknown";
      incomeBands[band] =
        (incomeBands[band] || 0) + 1;

      // REGION (using market/town fallback)
      const region = b.market || b.town || "Unknown";
      regionMap[region] =
        (regionMap[region] || 0) + 1;
    });

    const underservedRegions = Object.entries(regionMap)
      .filter(([_, count]) => count < 5)
      .map(([region]) => region);

    /* =====================================================
       6️⃣ BEHAVIOR BY GENDER
    ===================================================== */

    const genderLoanStats = {};

    loans.forEach(l => {
      const borrower = borrowers.find(
        b => b._id.toString() === l.borrowerId.toString()
      );
      if (!borrower) return;

      const gender = borrower.gender || "Unknown";

      if (!genderLoanStats[gender]) {
        genderLoanStats[gender] = {
          total: 0,
          defaulted: 0,
          totalAmount: 0
        };
      }

      genderLoanStats[gender].total++;
      genderLoanStats[gender].totalAmount += l.amount || 0;

      if (l.isDefaulted) genderLoanStats[gender].defaulted++;
    });

    const behaviorByGender = Object.keys(genderLoanStats).map(g => ({
      gender: g,
      defaultRate:
        genderLoanStats[g].total > 0
          ? Number(
              ((genderLoanStats[g].defaulted /
                genderLoanStats[g].total) * 100).toFixed(2)
            )
          : 0,
      averageLoanSize:
        genderLoanStats[g].total > 0
          ? Number(
              (genderLoanStats[g].totalAmount /
                genderLoanStats[g].total).toFixed(2)
            )
          : 0
    }));

    const highRiskDemographics =
      behaviorByGender.filter(g => g.defaultRate > 20);

    /* =====================================================
       7️⃣ MARITAL STATUS ANALYSIS
    ===================================================== */

    const maritalStatusAnalysis = {};

    borrowers.forEach(b => {
      const key = b.maritalStatus || "Unknown";

      if (!maritalStatusAnalysis[key]) {
        maritalStatusAnalysis[key] = {
          borrowers: 0,
          avgLoanSize: 0,
          defaultRate: 0,
          repaymentRate: 0
        };
      }

      maritalStatusAnalysis[key].borrowers++;

      const loanData = borrowerLoanMap[b._id];
      if (loanData && loanData.totalLoans > 0) {
        maritalStatusAnalysis[key].avgLoanSize +=
          loanData.totalAmount / loanData.totalLoans;

        maritalStatusAnalysis[key].defaultRate +=
          loanData.defaulted / loanData.totalLoans;

        maritalStatusAnalysis[key].repaymentRate +=
          loanData.totalRepaid / loanData.totalAmount;
      }
    });

    /* =====================================================
       8️⃣ EDUCATION ANALYSIS
    ===================================================== */

    const educationAnalysis = {};

    borrowers.forEach(b => {
      const key = b.educationLevel || "Unknown";

      if (!educationAnalysis[key]) {
        educationAnalysis[key] = {
          borrowers: 0,
          avgLoanSize: 0,
          repaymentRate: 0
        };
      }

      educationAnalysis[key].borrowers++;

      const loanData = borrowerLoanMap[b._id];
      if (loanData && loanData.totalLoans > 0) {
        educationAnalysis[key].avgLoanSize +=
          loanData.totalAmount / loanData.totalLoans;

        educationAnalysis[key].repaymentRate +=
          loanData.totalRepaid / loanData.totalAmount;
      }
    });

    /* =====================================================
       9️⃣ HOUSEHOLD RISK
    ===================================================== */

    const householdAnalysis = {
      small: { borrowers: 0, defaultRate: 0 },
      medium: { borrowers: 0, defaultRate: 0 },
      large: { borrowers: 0, defaultRate: 0 }
    };

    borrowers.forEach(b => {
      const size = b.householdSize || 0;

      const category =
        size <= 2 ? "small" :
        size <= 5 ? "medium" : "large";

      householdAnalysis[category].borrowers++;

      const loanData = borrowerLoanMap[b._id];
      if (loanData && loanData.totalLoans > 0) {
        householdAnalysis[category].defaultRate +=
          loanData.defaulted / loanData.totalLoans;
      }
    });

    /* =====================================================
       🔟 URBAN vs RURAL
    ===================================================== */

    const locationSplit = { urban: 0, rural: 0 };

    borrowers.forEach(b => {
      if (b.market?.toLowerCase().includes("city"))
        locationSplit.urban++;
      else locationSplit.rural++;
    });

    /* =====================================================
       1️⃣1️⃣ TENURE ANALYSIS
    ===================================================== */

    const tenureAnalysis = {
      lessThan1Year: 0,
      oneToThreeYears: 0,
      aboveThreeYears: 0
    };

    borrowers.forEach(b => {
      if (!b.createdAt) return;

      const years =
        (today - new Date(b.createdAt)) /
        (1000 * 60 * 60 * 24 * 365);

      if (years < 1) tenureAnalysis.lessThan1Year++;
      else if (years < 3) tenureAnalysis.oneToThreeYears++;
      else tenureAnalysis.aboveThreeYears++;
    });

    /* =====================================================
       FINAL RESPONSE
    ===================================================== */

    res.json({
      success: true,
      totalBorrowers: borrowers.length,

      customerDemographics: {
        ageDistribution,
        genderDistribution,
        occupationDistribution,
        incomeBands
      },

      geographicInsights: {
        borrowersByRegion: regionMap,
        underservedRegions
      },

      behaviorPatterns: {
        byGender: behaviorByGender,
        maritalStatusAnalysis,
        educationAnalysis,
        householdRiskAnalysis: householdAnalysis
      },

      socioeconomicInsights: {
        urbanRuralSplit: locationSplit,
        tenureAnalysis
      },

      marketOpportunitySignals: {
        highRiskDemographics
      }
    });

  } catch (error) {
    console.error("Demographics analysis error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate demographics analysis"
    });
  }
};