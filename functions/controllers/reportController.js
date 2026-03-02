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

    const portfolio = await Loan.aggregate([
      {
        $match: {
          ...baseFilter,
          status: { $in: ["active", "overdue"] }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$balance" }
        }
      }
    ]);

    const totalLoanPortfolio = portfolio[0]?.total || 0;

    /* ===============================
       TOTAL DISBURSED
    =============================== */

    const disbursed = await Loan.aggregate([
      {
        $match: {
          ...baseFilter,
          status: { $in: ["active", "overdue", "fully paid"] }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" }
        }
      }
    ]);

    const totalDisbursed = disbursed[0]?.total || 0;

    /* ===============================
       TOTAL COLLECTED
    =============================== */

    const collected = await Loan.aggregate([
      {
        $match: {
          ...baseFilter,
          status: { $in: ["active", "overdue", "fully paid"] }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$repaidAmount" }
        }
      }
    ]);

    const totalCollected = collected[0]?.total || 0;

    /* ===============================
       TOTAL PROFIT (INTEREST)
    =============================== */

    const profit = await Loan.aggregate([
      {
        $match: {
          ...baseFilter,
          status: "fully paid"
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$interest" }
        }
      }
    ]);

    const totalProfit = profit[0]?.total || 0;

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

    const totalLoans = await Loan.countDocuments({
      ...baseFilter,
      status: { $in: ["active", "overdue", "fully paid"] }
    });

    const defaultedLoans = await Loan.countDocuments({
      ...baseFilter,
      isDefaulted: true
    });

    const defaultRate =
      totalLoans > 0
        ? Number(((defaultedLoans / totalLoans) * 100).toFixed(2))
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
      PAR1: totalLoanPortfolio
        ? Number(((par1 / totalLoanPortfolio) * 100).toFixed(2))
        : 0,
      PAR7: totalLoanPortfolio
        ? Number(((par7 / totalLoanPortfolio) * 100).toFixed(2))
        : 0,
      PAR30: totalLoanPortfolio
        ? Number(((par30 / totalLoanPortfolio) * 100).toFixed(2))
        : 0
    };

    /* ===============================
       TRENDS
    =============================== */

    const disbursementTrend = await Loan.aggregate([
      {
        $match: {
          ...baseFilter,
          status: { $in: ["active", "overdue", "fully paid"] }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m", date: "$createdAt" }
          },
          amount: { $sum: "$amount" }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const repaymentTrend = await Loan.aggregate([
      {
        $match: {
          ...baseFilter,
          repaidAmount: { $gt: 0 }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m", date: "$updatedAt" }
          },
          amount: { $sum: "$repaidAmount" }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const loanGrowthTrend = await Loan.aggregate([
      {
        $match: {
          ...baseFilter
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m", date: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const defaultTrend = await Loan.aggregate([
      {
        $match: {
          ...baseFilter,
          isDefaulted: true
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m", date: "$updatedAt" }
          },
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

    const repaymentsToday = await Loan.aggregate([
      {
        $match: {
          ...baseFilter,
          updatedAt: { $gte: startOfToday }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$repaidAmount" }
        }
      }
    ]);

    const overdueLoansCount = overdueLoans.length;

    const agentsActiveToday = await Agent.countDocuments({
      lenderId,
      lastActiveAt: { $gte: startOfToday }
    });

    return res.json({
      success: true,
      dashboardSummary: {
        totalLoanPortfolio,
        totalDisbursed,
        totalCollected,
        portfolioAtRisk: par,
        activeBorrowers: activeBorrowers.length,
        activeLoans,
        totalProfitInterestEarned: totalProfit,
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
        repaymentsReceivedToday: repaymentsToday[0]?.total || 0,
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
    const agents = await Agent.find().lean();

    const data = await Promise.all(
      agents.map(async (agent) => {

        // Loans handled by agent
        const loans = await Loan.find({
          requestedByAgentId: agent._id,
          loanRequestStatus: "approved"
        });

        const totalDisbursed = loans.reduce(
          (sum, loan) => sum + (loan.amount || 0),
          0
        );

        // Total customers handled
        const totalCustomers = await Customer.countDocuments({
          registeredBy: agent._id
        });

        // Commission earned
        const commissions = await AgentCommission.find({
          agentId: agent._id,
          status: "approved"
        });

        const commissionEarned = commissions.reduce(
          (sum, c) => sum + (c.amount || 0),
          0
        );

        return {
          _id: agent._id,
          lenderId: agent.lenderId,
          name: agent.fullName || agent.name,
          phone: agent.phone,
          status: agent.status,
          password:agent.password,
          region: agent.region || "N/A",
          totalEarnings: commissionEarned,
          walletBalance: agent.walletBalance || 0,
          commissionEarned,
          totalCustomers,
          role: "agent",
          loansHandled: loans.length,
          totalDisbursed
        };
      })
    );

    res.json({
      success: true,
      count: data.length,
      data
    });

  } catch (error) {
    console.error("Agents report error:", error);
    res.status(500).json({ message: error.message });
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
    const data = await Loan.aggregate([
      // 🔹 Join customer collection
      {
        $lookup: {
          from: "customers",              // collection name (check exact name in MongoDB)
          localField: "borrowerId",       // field in Loan
          foreignField: "_id",            // field in Customer
          as: "borrower"
        }
      },

      // 🔹 Convert array to object
      { $unwind: "$borrower" },

      // 🔹 Group by occupation
      {
        $group: {
          _id: { $ifNull: ["$borrower.occupation", "Unknown"] },
          value: { $sum: "$amount" }
        }
      },

      // 🔹 Format output
      {
        $project: {
          _id: 0,
          type: "$_id",
          value: 1
        }
      }
    ]);

    res.json({
      success: true,
      data
    });

  } catch (err) {
    console.error("Business type report error:", err);
    res.status(500).json({ message: err.message });                                                          
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

    /* ================= PHONE → COUNTRY MAP ================= */
    function getCountryFromPhone(phone) {
      if (!phone) return "Unknown";

      const clean = phone.replace(/\s/g, "");

      if (clean.startsWith("+254")) return "KENYA"; // Kenya
      if (clean.startsWith("+256")) return "UGANDA"; // Uganda
      if (clean.startsWith("+234")) return "NIGERIA"; // Nigeria
      if (clean.startsWith("+250")) return "RWANDA"; // Rwanda
      if (clean.startsWith("+255")) return "TANZANIA"; // Tanzania
      if (clean.startsWith("+233")) return "GHANA";  // Ghana

      return "Unknown";
    }

    /* ================= FETCH DATA ================= */
    const customers = await Customer.find().lean();

    const regionGroups = {};

    for (const customer of customers) {

      const loans = await Loan.find({
        borrowerId: customer._id,
        loanRequestStatus: "approved"
      }).lean();

      const totalLoanAmount = loans.reduce(
        (sum, l) => sum + (l.amount || 0),
        0
      );

      const totalOutstanding = loans.reduce(
        (sum, l) => sum + (l.balance || 0),
        0
      );

      const totalRepaid = loans.reduce(
        (sum, l) =>
          sum +
          (Array.isArray(l.repayments)
            ? l.repayments.reduce((s, r) => s + (r.amount || 0), 0)
            : 0),
        0
      );

      const region = getCountryFromPhone(customer.phone);

      if (!regionGroups[region]) {
        regionGroups[region] = {
          totalLoan: 0,
          totalRepaid: 0,
          borrowers: []
        };
      }

      regionGroups[region].totalLoan += totalLoanAmount;
      regionGroups[region].totalRepaid += totalRepaid;

      regionGroups[region].borrowers.push({
        full_name: customer.fullName,
        borrower_id: customer._id,
        date_of_birth: customer.dateOfBirth,
        phone: customer.phone,
        email: customer.email,
        address: customer.physicalAddress || "",
        region,
        status: customer.status,
        marital_status: customer.maritalStatus,
        gender: customer.gender,
        occupation: customer.occupation,
        loan_credit_score: customer.creditScore || 500,
        number_of_active_loans: loans.filter(l => l.balance > 0).length,
        total_loans: loans.length,
        total_loan_amount: totalLoanAmount,
        total_outstanding_amount: totalOutstanding,
        balance: totalOutstanding,
        interest: loans.reduce((s, l) => s + (l.interest || 0), 0),
        repayment_due_date:
          loans.length > 0
            ? loans.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0].dueDate
            : null,
        payment_histories:
          loans.length > 0 && Array.isArray(loans[0].repayments)
            ? loans[0].repayments.map(r => ({
                payment_date: r.date,
                amount: r.amount,
                status: r.wasPaymentLate ? "Late" : "Paid"
              }))
            : []
      });
    }

    /* ================= CALCULATE PERCENT ================= */
    const result = Object.keys(regionGroups).map(region => {
      const g = regionGroups[region];

      const percent =
        g.totalLoan === 0
          ? 0
          : Math.round((g.totalRepaid / g.totalLoan) * 100);

      return {
        region,
        percent,
        borrowers: g.borrowers
      };
    });

    return res.status(200).json({
      success: true,
      count: result.length,
      data: result
    });

  } catch (error) {
    console.error("Region performance error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
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


