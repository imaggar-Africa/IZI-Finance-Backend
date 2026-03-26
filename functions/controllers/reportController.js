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
          defaultedBalance: {
            $sum: { $cond: ["$isDefaulted", "$balance", 0] }
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
      defaultedBalance: 0,
      interestEarned: 0
    };

    /* ===============================
       ACTIVE LOANS & BORROWERS
    =============================== */

    const activeLoans = kpis.activeLoans;

    const activeBorrowers = await Loan.distinct(
      "borrowerId",
      {
        ...baseFilter,
        status: "active"
      }
    );

    /* ===============================
       DEFAULT RATE (Balance based)
    =============================== */

    const defaultRate =
      kpis.totalPortfolio > 0
        ? Number(((kpis.defaultedBalance / kpis.totalPortfolio) * 100).toFixed(2))
        : 0;

    /* ===============================
       PAR
    =============================== */

    const overdueLoans = await Loan.find({
      ...baseFilter,
      status: "overdue"
    });

    let par1 = 0, par7 = 0, par30 = 0, par60 = 0, par90 = 0;
    overdueLoans.forEach((loan) => {
      const days =
        (now - new Date(loan.dueDate)) /
        (1000 * 60 * 60 * 24);

      if (days >= 1) par1 += loan.balance;
      if (days >= 7) par7 += loan.balance;
      if (days >= 30) par30 += loan.balance;
      if (days >= 60) par60 += loan.balance;
      if (days >= 90) par90 += loan.balance;
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
        : 0,
      PAR60: kpis.totalPortfolio
        ? Number(((par60 / kpis.totalPortfolio) * 100).toFixed(2))
        : 0,
      PAR90: kpis.totalPortfolio
        ? Number(((par90 / kpis.totalPortfolio) * 100).toFixed(2))
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

    // Trend based on Loan repayments array
    const repaymentTrend = await Loan.aggregate([
      { $match: baseFilter },
      { $unwind: "$repayments" },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$repayments.date" } },
          amount: { $sum: "$repayments.amount" }
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

    const repaymentsTodayAggregation = await Loan.aggregate([
      { $match: baseFilter },
      { $unwind: "$repayments" },
      {
        $match: {
          "repayments.date": { $gte: startOfToday }
        }
      },
      { $group: { _id: null, total: { $sum: "$repayments.amount" } } }
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
    const lenderId = req.user._id;
    const { startDate, endDate, agentId, status } = req.query;

    const baseFilter = {
      lenderId: new mongoose.Types.ObjectId(lenderId),
      loanRequestStatus: "approved",
      isDeleted: { $ne: true }
    };

    // Period filtering
    if (startDate || endDate) {
      baseFilter.issueDate = {};
      if (startDate) baseFilter.issueDate.$gte = new Date(startDate);
      if (endDate) baseFilter.issueDate.$lte = new Date(endDate);
    }

    if (agentId) baseFilter.requestedByAgentId = new mongoose.Types.ObjectId(agentId);
    if (status) baseFilter.status = status;

    const loans = await Loan.find(baseFilter)
      .populate("borrowerId", "fullName creditLevel town market")
      .populate("requestedByAgentId", "name");

    const now = new Date();

    /* =====================================================
       1️⃣ LOAN VOLUME METRICS
    ===================================================== */
    const totalLoansIssued = loans.length;
    const totalAmountDisbursed = loans.reduce((sum, l) => sum + (l.amount || 0), 0);
    const averageLoanSize = totalLoansIssued > 0 ? Number((totalAmountDisbursed / totalLoansIssued).toFixed(2)) : 0;

    // Breakdown by Product
    const productMap = {};
    loans.forEach(l => {
      const product = l.productType || "General";
      productMap[product] = (productMap[product] || 0) + 1;
    });
    const loansByProduct = Object.keys(productMap).map(key => ({
      product: key,
      count: productMap[key],
      percentage: totalLoansIssued > 0 ? Number(((productMap[key] / totalLoansIssued) * 100).toFixed(2)) : 0
    }));

    // Breakdown by Agent
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
       2️⃣ LOAN STATUS BREAKDOWN
    ===================================================== */
const statusCounts = {
 pending: 0,
 active: 0,
 completed: 0,
 overdue: 0
};

loans.forEach(l => {
 if (l.status === "pending") statusCounts.pending++;
 else if (l.status === "active") statusCounts.active++;
 else if (l.status === "fully paid") statusCounts.completed++;
 else if (l.status === "overdue") statusCounts.overdue++;
});

const statusBreakdown = [
 { status: "Pending", count: statusCounts.pending },
 { status: "Active", count: statusCounts.active },
 { status: "Completed", count: statusCounts.completed },
 { status: "Overdue", count: statusCounts.overdue }
];

    /* =====================================================
       3️⃣ LOAN STATUS TREND (Aggregation)
    ===================================================== */
    const statusTrendMatch = { ...baseFilter };
    delete statusTrendMatch.issueDate; // Trend usually covers a wider range or specific period handled differently

    const trends = await Loan.aggregate([
      { $match: baseFilter },
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

    const dailyTrend = trends.map(t => ({
      date: `${t._id.day}/${t._id.month}`,
      count: t.count
    }));

    /* =====================================================
       4️⃣ DISBURSEMENT ANALYSIS (NEW vs REPEAT)
    ===================================================== */
    let firstTime = 0;
    let repeat = 0;

    // To properly determine if "First Time" in this period, 
    // we check if they had ANY loan before this period.
    // Optimization: Count loans per borrower across history
    const borrowerIds = [...new Set(loans.map(l => l.borrowerId?._id).filter(id => id))];
    const historicalCounts = await Loan.aggregate([
      { $match: { borrowerId: { $in: borrowerIds }, loanRequestStatus: "approved" } },
      { $group: { _id: "$borrowerId", count: { $sum: 1 } } }
    ]);
    const histMap = historicalCounts.reduce((acc, h) => { acc[h._id.toString()] = h.count; return acc; }, {});

    loans.forEach(l => {
      const bid = l.borrowerId?._id?.toString();
      if (bid && histMap[bid] > 1) repeat++;
      else firstTime++;
    });

    const firstTimeRatio = totalLoansIssued > 0 ? Number(((firstTime / totalLoansIssued) * 100).toFixed(2)) : 0;

    /* =====================================================
       5️⃣ RISK INDICATORS & WARNING SIGNALS
    ===================================================== */
    let highRiskLoans = 0;
    let nearingDueDate = 0;
    const overdueAmount = loans
      .filter(l => l.status === "overdue")
      .reduce((sum, l) => sum + (l.balance || 0), 0);

    const flaggedAreas = new Set();

    loans.forEach(l => {
      const dueDate = new Date(l.dueDate);
      const daysToDue = Math.floor((dueDate - now) / (1000 * 60 * 60 * 24));

      if (l.isDefaulted || (l.status === "overdue" && Math.abs(daysToDue) > 30)) {
        highRiskLoans++;
        if (l.borrowerId?.town) flaggedAreas.add(l.borrowerId.town);
      }

      if (daysToDue >= 0 && daysToDue <= 7) {
        nearingDueDate++;
      }
    });

    res.json({
      success: true,
      loanVolumeMetrics: {
        totalLoansIssued,
        totalAmountDisbursed,
        averageLoanSize,
        loansByProduct,
        loansByAgent
      },
      statusBreakdown,
      statusTrend: {
        daily: dailyTrend,
        weekly: [], // Optional: add weekly agg if needed
        monthly: []
      },
      disbursementAnalysis: {
        newBorrowers: firstTime,
        newBorrowersPercent: Number(((firstTime / (totalLoansIssued || 1)) * 100).toFixed(1)),
        repeatBorrowers: repeat,
        repeatBorrowersPercent: Number(((repeat / (totalLoansIssued || 1)) * 100).toFixed(1)),
        firstTimeBorrowerRatio: firstTimeRatio
      },
      riskIndicators: {
        highRiskLoans,
        overdueAmount,
        loansNearingDueDate: nearingDueDate
      },
      earlyWarningSignals: {
        potentiallyRiskyCount: highRiskLoans,
        flaggedGeographicAreas: Array.from(flaggedAreas).length,
        agentsUnderReview: 0
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
    const lenderId = req.user._id;
    const { startDate, endDate, region, agentId, loanProduct } = req.query;

    const baseFilter = {
      lenderId: new mongoose.Types.ObjectId(lenderId),
      loanRequestStatus: "approved",
      status: { $in: ["active", "overdue", "fully paid"] },
      isDeleted: { $ne: true }
    };

    if (startDate || endDate) {
      baseFilter.dueDate = {};
      if (startDate) baseFilter.dueDate.$gte = new Date(startDate);
      if (endDate) baseFilter.dueDate.$lte = new Date(endDate);
    }

    if (agentId) baseFilter.requestedByAgentId = new mongoose.Types.ObjectId(agentId);
    if (loanProduct) baseFilter.productType = loanProduct;

    const loans = await Loan.find(baseFilter)
      .populate("borrowerId", "fullName town region")
      .populate("requestedByAgentId", "name")
      .populate("repayments.transactionId");

    let filteredLoans = loans;

    if (region) {
      filteredLoans = loans.filter(
        l => l.borrowerId?.town === region || l.borrowerId?.region === region
      );
    }

    const today = new Date();

    /* ==============================
       COLLECTION PERFORMANCE
    ============================== */

    const totalExpectedRepayments = filteredLoans.reduce(
      (sum, l) => sum + (l.totalRepayment || 0),
      0
    );

    const overdueAmount = filteredLoans
      .filter(l => l.status === "overdue")
      .reduce((sum, l) => sum + (l.balance || 0), 0);

    let missedRepaymentsCount = 0;

    filteredLoans.forEach(l => {
      if (l.status === "overdue" || l.balance > 0) {
        missedRepaymentsCount++;
      }
    });

    /* ==============================
       REPAYMENT BEHAVIOR
    ============================== */

    let totalRepayments = 0;
    let lateRepayments = 0;
    let onTimeRepayments = 0;
    let earlyRepayments = 0;
    let partialPayments = 0;
    let fullPayments = 0;
    let totalDaysLate = 0;

    filteredLoans.forEach(loan => {
      loan.repayments.forEach(r => {
        totalRepayments++;

        if (r.wasPaymentLate) {
          lateRepayments++;
          totalDaysLate += r.daysLate || 0;
        } else {
          onTimeRepayments++;

          if (new Date(r.date) < new Date(r.expectedPaymentDate)) {
            earlyRepayments++;
          }
        }

        if (r.amount >= (loan.dailyRepayment || 0)) fullPayments++;
        else partialPayments++;
      });
    });

    /* ==============================
       CHANNEL ANALYSIS
    ============================== */

    // ✅ Correct totalCollected calculation from repayments array
    let totalCollected = 0;
    const channelMap = { mpesa: 0, cash: 0, bank_transfer: 0, other: 0 };
    const regionMap = {};
    const agentRepaymentMap = {};

    filteredLoans.forEach(loan => {
      loan.repayments.forEach(r => {
        totalCollected += r.amount || 0;

        // Check channel/method if available via populated transaction
        const method =
          r.transactionId?.paymentMethod?.toLowerCase() ||
          (r.transactionId?.checkoutRequestID ? "mpesa" : "other");
        
        channelMap[method] = (channelMap[method] || 0) + r.amount;

        const regionName = loan.borrowerId?.town || "Other";
        const agentName = loan.requestedByAgentId?.name || "Direct";

        regionMap[regionName] = (regionMap[regionName] || 0) + r.amount;
        agentRepaymentMap[agentName] = (agentRepaymentMap[agentName] || 0) + r.amount;
      });
    });

    const collectionRate =
      totalExpectedRepayments > 0
        ? Number(((totalCollected / totalExpectedRepayments) * 100).toFixed(2))
        : 0;

    /* ==============================
       AGING ANALYSIS
    ============================== */

    let aging = {
      current: 0,
      days_1_7: 0,
      days_8_30: 0,
      days_31_90: 0,
      days_90_plus: 0
    };

    filteredLoans.forEach(loan => {
      if (loan.balance <= 0) return;

      const diffDays = Math.floor(
        (today - new Date(loan.dueDate)) / (1000 * 60 * 60 * 24)
      );

      if (diffDays <= 0) aging.current += loan.balance;
      else if (diffDays <= 7) aging.days_1_7 += loan.balance;
      else if (diffDays <= 30) aging.days_8_30 += loan.balance;
      else if (diffDays <= 90) aging.days_31_90 += loan.balance;
      else aging.days_90_plus += loan.balance;
    });

    res.json({
      success: true,

      collectionPerformance: {
        totalExpectedRepayments,
        totalCollected,
        collectionRate,
        missedRepayments: missedRepaymentsCount,
        overdueAmount
      },

      repaymentBehavior: {
        onTime: onTimeRepayments,
        late: lateRepayments,
        earlyRepayments:
          totalRepayments > 0
            ? Number(((earlyRepayments / totalRepayments) * 100).toFixed(2))
            : 0,

        averageDaysLate:
          lateRepayments > 0
            ? Number((totalDaysLate / lateRepayments).toFixed(1))
            : 0,

        partialVsFull: {
          partial: partialPayments,
          full: fullPayments
        }
      },

      channelAnalysis: {
        byMethod: Object.keys(channelMap).map(k => ({
          method: k,
          amount: channelMap[k]
        })),

        byRegion: Object.keys(regionMap).map(k => ({
          region: k,
          amount: regionMap[k]
        })),

        byAgent: Object.keys(agentRepaymentMap).map(k => ({
          agent: k,
          amount: agentRepaymentMap[k]
        }))
      },

      agingAnalysis: aging
    });

  } catch (error) {
    console.error("Repayment Report Error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to generate repayment report" });
  }
};

/* ===========================
   PROFIT & INTEREST REPORT
=========================== */
exports.getProfitReport = async (req, res) => {
  try {
    const lenderId = req.user._id;
    const { startDate, endDate, groupBy = "month" } = req.query;

    const baseFilter = {
      lenderId: new mongoose.Types.ObjectId(lenderId),
      loanRequestStatus: "approved",
      isDeleted: { $ne: true }
    };

    const loans = await Loan.find(baseFilter);
    const now = new Date();

    /* =====================================================
       1️⃣ REVENUE METRICS (INTEREST, FEES, PENALTIES)
    ===================================================== */
    let totalInterestEarned = 0;
    let periodInterestEarned = 0;
    const startObj = startDate ? new Date(startDate) : null;
    const endObj = endDate ? new Date(endDate) : null;

    // Calculate interest proportional to repayments
    loans.forEach(loan => {
      const ratio = loan.totalRepayment > 0 ? (loan.repaidAmount / loan.totalRepayment) : 0;
      const loanInterest = loan.interest || 0;
      totalInterestEarned += (loanInterest * ratio);
    });

    // Aggregated Period Interest from Loan repayments array
    const periodInterestAggregation = await Loan.aggregate([
      { $match: baseFilter },
      { $unwind: "$repayments" },
      {
        $match: {
          "repayments.date": {
            $gte: startObj || new Date(0),
            $lte: endObj || now
          }
        }
      },
      {
        $group: {
          _id: null,
          interestPortion: {
            $sum: {
              $multiply: [
                "$repayments.amount",
                { $cond: [{ $gt: ["$totalRepayment", 0] }, { $divide: ["$interest", "$totalRepayment"] }, 0] }
              ]
            }
          }
        }
      }
    ]);

    periodInterestEarned = periodInterestAggregation[0]?.interestPortion || 0;

    const revenueMetrics = {
      totalInterestEarned: Math.round(totalInterestEarned),
      interestEarnedThisPeriod: Math.round(periodInterestEarned),
      feesCollected: 0,
      penaltiesCollected: 0
    };

    /* =====================================================
       2️⃣ PROFITABILITY METRICS
    ===================================================== */
    const totalDisbursed = loans.reduce((sum, l) => sum + (l.amount || 0), 0);
    const grossProfit = totalInterestEarned;
    const netProfit = grossProfit;
    
    const yieldOnPortfolio = totalDisbursed > 0 
      ? Number(((grossProfit / totalDisbursed) * 100).toFixed(1)) 
      : 0;

    const profitabilityMetrics = {
      grossProfit: Math.round(grossProfit),
      netProfit: Math.round(netProfit),
      yieldOnPortfolio,
      averageInterestPerLoan: loans.length > 0 ? Math.round(totalInterestEarned / loans.length) : 0
    };

    /* =====================================================
       3️⃣ EFFICIENCY INDICATORS
    ===================================================== */
    const activeBorrowers = new Set(loans.map(l => l.borrowerId.toString())).size;
    const activeAgents = new Set(loans.map(l => l.requestedByAgentId?.toString()).filter(id => id)).size;

    const efficiencyIndicators = {
      costPerLoan: 0,
      revenuePerBorrower: activeBorrowers > 0 ? Math.round(grossProfit / activeBorrowers) : 0,
      revenuePerAgent: activeAgents > 0 ? Math.round(grossProfit / activeAgents) : 0,
      activeAgents
    };

    /* =====================================================
       4️⃣ TREND CHARTS
    ===================================================== */
    const interestTrend = await Loan.aggregate([
      { $match: baseFilter },
      { $unwind: "$repayments" },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$repayments.date" } },
          interest: {
            $sum: {
              $multiply: [
                "$repayments.amount",
                { $cond: [{ $gt: ["$totalRepayment", 0] }, { $divide: ["$interest", "$totalRepayment"] }, 0] }
              ]
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const profitTrend = interestTrend; // For now profit is linked to interest (simplified)

    /* =====================================================
       5️⃣ GEOGRAPHIC Breakdown
    ===================================================== */
    const townBreakdown = await Loan.aggregate([
      { $match: baseFilter },
      { $unwind: "$repayments" },
      {
        $lookup: {
          from: "customers",
          localField: "borrowerId",
          foreignField: "_id",
          as: "customer"
        }
      },
      { $unwind: "$customer" },
      {
        $group: {
          _id: { $ifNull: ["$customer.town", "Unknown"] },
          interest: {
            $sum: {
              $multiply: [
                "$repayments.amount",
                { $cond: [{ $gt: ["$totalRepayment", 0] }, { $divide: ["$interest", "$totalRepayment"] }, 0] }
              ]
            }
          }
        }
      },
      { $sort: { interest: -1 } }
    ]);

    res.json({
      success: true,
      revenueMetrics,
      profitabilityMetrics,
      efficiencyIndicators,
      interestIncomeTrend: interestTrend.map(t => ({ date: t._id, value: Math.round(t.interest) })),
      profitTrend: interestTrend.map(t => ({ date: t._id, value: Math.round(t.interest) })),
      geoBreakdown: townBreakdown.map(t => ({ label: t._id || "Unknown", value: Math.round(t.interest) }))
    });

  } catch (err) {
    console.error("Profit report error:", err);
    res.status(500).json({ message: err.message });
  }
};

/* ===========================
   BORROWERS PROFESSIONAL REPORTS
=========================== */
exports.getBorrowersReport = async (req, res) => {
  try {
    const lenderId = req.user._id;
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // 1. Get all agents for this lender to filter customers
    const agents = await Agent.find({ lenderId }).select("_id").lean();
    const agentIds = agents.map(a => a._id);

    const borrowerMatch = { 
      $or: [
        { registeredBy: new mongoose.Types.ObjectId(lenderId), registeredByModel: "User" },
        { agentId: { $in: agentIds } },
        { assignedAgent: { $in: agentIds } }
      ],
      isDeleted: { $ne: true }
    };

    const loanBaseFilter = {
      lenderId: new mongoose.Types.ObjectId(lenderId),
      loanRequestStatus: "approved",
      isDeleted: { $ne: true }
    };

    const periodLoanFilter = { ...loanBaseFilter };
    if (startDate || endDate) {
      periodLoanFilter.issueDate = {};
      if (startDate) periodLoanFilter.issueDate.$gte = new Date(startDate);
      if (endDate) periodLoanFilter.issueDate.$lte = new Date(endDate);
    }

    /* =========================================================
       1️⃣ BORROWER BASE METRICS
    ========================================================= */
    const totalRegisteredBorrowers = await Customer.countDocuments(borrowerMatch);
    
    const activeBorrowersCount = await Loan.aggregate([
      { $match: { ...loanBaseFilter, status: "active" } },
      { $group: { _id: "$borrowerId" } },
      { $count: "count" }
    ]);

    const newBorrowersCount = await Customer.countDocuments({
      ...borrowerMatch,
      ...(dateFilter.createdAt ? { createdAt: dateFilter.createdAt } : {})
    });

    const repeatBorrowersList = await Loan.aggregate([
      { $match: loanBaseFilter },
      { $group: { _id: "$borrowerId", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]);

    /* =========================================================
       2️⃣ CREDIT BEHAVIOR
    ========================================================= */
    const totalLoansCount = await Loan.countDocuments(loanBaseFilter);
    const averageLoansPerBorrower = totalRegisteredBorrowers > 0 
      ? Number((totalLoansCount / totalRegisteredBorrowers).toFixed(2)) 
      : 0;

    const repaymentAggregation = await Loan.aggregate([
      { $match: loanBaseFilter },
      {
        $group: {
          _id: null,
          totalExpected: { $sum: "$totalRepayment" },
          totalCollected: { $sum: { $sum: "$repayments.amount" } },
          totalSuccessfulRepayments: { 
            $sum: { $size: { $ifNull: ["$repayments", []] } } 
          }
        }
      }
    ]);

    const repStats = repaymentAggregation[0] || { totalExpected: 0, totalCollected: 0, totalSuccessfulRepayments: 0 };
    const repaymentPercentage = repStats.totalExpected > 0 
      ? Number(((repStats.totalCollected / repStats.totalExpected) * 100).toFixed(2)) 
      : 0;
    
    // Repayment score normalized to 0-10
    const borrowerRepaymentScore = Number((repaymentPercentage / 10).toFixed(1));

    const topGoodPayers = await Loan.aggregate([
      { $match: loanBaseFilter },
      { $group: { _id: "$borrowerId", totalPaid: { $sum: { $sum: "$repayments.amount" } } } },
      { $sort: { totalPaid: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "customers",
          localField: "_id",
          foreignField: "_id",
          as: "customer"
        }
      },
      { $unwind: "$customer" },
      { $project: { name: "$customer.fullName", totalPaid: 1 } }
    ]);

    const topDefaulters = await Loan.aggregate([
      { $match: { ...loanBaseFilter, isDefaulted: true } },
      { $group: { _id: "$borrowerId", defaultCount: { $sum: 1 } } },
      { $sort: { defaultCount: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "customers",
          localField: "_id",
          foreignField: "_id",
          as: "customer"
        }
      },
      { $unwind: "$customer" },
      { $project: { name: "$customer.fullName", defaultCount: 1 } }
    ]);

    /* =========================================================
       3️⃣ SEGMENTATION
    ========================================================= */
    const segmentationData = await Customer.aggregate([
      { $match: borrowerMatch },
      {
        $facet: {
          byGender: [{ $group: { _id: { $ifNull: ["$gender", "Unknown"] }, count: { $sum: 1 } } }],
          byBusinessType: [{ $group: { _id: { $ifNull: ["$occupation", "Unknown"] }, count: { $sum: 1 } } }],
          byRegion: [{ $group: { _id: { $ifNull: ["$town", "Unknown"] }, count: { $sum: 1 } } }],
          byRiskLevel: [{ $group: { _id: { $ifNull: ["$creditLevel", "High Risk"] }, count: { $sum: 1 } } }]
        }
      }
    ]);

    const formatSegment = (data) => data.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {});

    const seg = segmentationData[0];
    const segmentation = {
      borrowersByGender: formatSegment(seg.byGender),
      borrowersByBusinessType: formatSegment(seg.byBusinessType),
      borrowersByRegion: formatSegment(seg.byRegion),
      borrowersByRiskLevel: formatSegment(seg.byRiskLevel)
    };

    /* =========================================================
       4️⃣ LIFECYCLE INSIGHTS
    ========================================================= */
    const repeatBorrowersCount = repeatBorrowersList.length;
    const firstTimeBorrowersCount = Math.max(0, totalRegisteredBorrowers - repeatBorrowersCount);

    const borrowerRetentionRate = totalRegisteredBorrowers > 0 
      ? Number(((repeatBorrowersCount / totalRegisteredBorrowers) * 100).toFixed(2)) 
      : 0;

    // Dormant borrowers: registered with this lender's agents, but no loan in selected period
    // If no period, use last 90 days as default for "activity"
    const activityPeriod = {};
    if (startDate || endDate) {
      if (startDate) activityPeriod.$gte = new Date(startDate);
      if (endDate) activityPeriod.$lte = new Date(endDate);
    } else {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      activityPeriod.$gte = ninetyDaysAgo;
    }

    const borrowersWithActivity = await Loan.distinct("borrowerId", {
      lenderId,
      issueDate: activityPeriod
    });

    const dormantBorrowersCount = await Customer.countDocuments({
      ...borrowerMatch,
      _id: { $nin: borrowersWithActivity }
    });

    const defaultRateBySegment = await Loan.aggregate([
      { $match: loanBaseFilter },
      {
        $lookup: {
          from: "customers",
          localField: "borrowerId",
          foreignField: "_id",
          as: "customer"
        }
      },
      { $unwind: "$customer" },
      {
        $group: {
          _id: "$customer.creditLevel",
          total: { $sum: 1 },
          defaulted: { $sum: { $cond: ["$isDefaulted", 1, 0] } }
        }
      },
      {
        $project: {
          segment: { $ifNull: ["$_id", "Unknown"] },
          rate: { 
            $cond: [
              { $gt: ["$total", 0] }, 
              { $multiply: [{ $divide: ["$defaulted", "$total"] }, 100] }, 
              0
            ] 
          }
        }
      }
    ]);

    res.json({
      success: true,
      borrowerBaseMetrics: {
        totalRegisteredBorrowers,
        activeBorrowers: activeBorrowersCount[0]?.count || 0,
        newBorrowers: newBorrowersCount,
        repeatBorrowers: repeatBorrowersCount
      },
      creditBehavior: {
        averageLoansPerBorrower,
        borrowerRepaymentScore,
        repaymentPercentage,
        defaultRateBySegment,
        topGoodPayers,
        topDefaulters
      },
      segmentation,
      lifecycleInsights: {
        firstTimeBorrowers: firstTimeBorrowersCount,
        repeatBorrowers: repeatBorrowersCount,
        borrowerRetentionRate,
        dormantBorrowers: dormantBorrowersCount
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
    const { startDate, endDate } = req.query;

    const startObj = startDate ? new Date(startDate) : new Date(0);
    const endObj = endDate ? new Date(endDate) : new Date();

    // 1. Fetch Agents for this lender (excluding deleted ones)
    const agents = await Agent.find({ 
      lenderId,
      isDeleted: { $ne: true } 
    }).select("name phone status lastActiveAt").lean();
    
    const agentMap = new Map();
    agents.forEach(a => {
      agentMap.set(a._id.toString(), {
        ...a,
        loansIssued: 0,
        amountDisbursed: 0,
        collections: 0,
        activeClients: 0,
        totalActiveBalance: 0,
        overdueBalance: 0,
        totalLoans: 0,
        defaultedLoansCount: 0,
        allTimeRepaid: 0,
        allTimeExpected: 0,
        riskFlags: []
      });
    });

    // 2. Aggregate Productivity & Portfolio Quality from Loans (excluding deleted records)
    const loanStats = await Loan.aggregate([
      {
        $match: {
          lenderId: new mongoose.Types.ObjectId(lenderId),
          requestedByAgentId: { $ne: null },
          loanRequestStatus: "approved",
          isDeleted: { $ne: true } // Skip deleted loans
        }
      },
      // Ensure borrower (customer) is not deleted
      {
        $lookup: {
          from: "customers",
          localField: "borrowerId",
          foreignField: "_id",
          as: "borrower"
        }
      },
      { $unwind: "$borrower" },
      { $match: { "borrower.isDeleted": { $ne: true } } },
      {
        $facet: {
          "productivity": [
            { $match: { issueDate: { $gte: startObj, $lte: endObj } } },
            {
              $group: {
                _id: "$requestedByAgentId",
                loansIssued: { $sum: 1 },
                amountDisbursed: { $sum: "$amount" },
                activeClients: { $addToSet: "$borrowerId" }
              }
            }
          ],
          "quality": [
            {
              $group: {
                _id: "$requestedByAgentId",
                totalActiveBalance: { 
                  $sum: { $cond: [{ $in: ["$status", ["active", "overdue"]] }, "$balance", 0] } 
                },
                overdueBalance: { 
                  $sum: { $cond: [{ $eq: ["$status", "overdue"] }, "$balance", 0] } 
                },
                totalLoans: { $sum: 1 },
                defaultedLoansCount: { $sum: { $cond: ["$isDefaulted", 1, 0] } },
                allTimeRepaid: { $sum: "$repaidAmount" },
                allTimeExpected: { $sum: "$totalRepayment" }
              }
            }
          ],
          "unusualPatterns": [
            {
              $group: {
                _id: { agent: "$requestedByAgentId", borrower: "$borrowerId" },
                activeLoanCount: { 
                  $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } 
                }
              }
            },
            { $match: { activeLoanCount: { $gt: 1 } } },
            {
              $group: {
                _id: "$_id.agent",
                suspiciousBorrowersCount: { $sum: 1 }
              }
            }
          ]
        }
      }
    ]);

    // 3. Aggregate Collections from Transactions
    const collectionStats = await Transaction.aggregate([
      {
        $match: {
          type: "repayment",
          status: "successful",
          createdAt: { $gte: startObj, $lte: endObj }
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
      { 
        $match: { 
          "loan.lenderId": new mongoose.Types.ObjectId(lenderId),
          "loan.requestedByAgentId": { $ne: null },
          "loan.isDeleted": { $ne: true } // Skip transactions for deleted loans
        } 
      },
      {
        $group: {
          _id: "$loan.requestedByAgentId",
          collections: { $sum: "$amount" }
        }
      }
    ]);

    // 4. Merge results into agentMap
    const prod = loanStats[0].productivity;
    const qual = loanStats[0].quality;
    const patterns = loanStats[0].unusualPatterns;

    prod.forEach(p => {
      const a = agentMap.get(p._id.toString());
      if (a) {
        a.loansIssued = p.loansIssued;
        a.amountDisbursed = p.amountDisbursed;
        a.activeClients = p.activeClients.length;
      }
    });

    qual.forEach(q => {
      const a = agentMap.get(q._id.toString());
      if (a) {
        a.totalActiveBalance = q.totalActiveBalance;
        a.overdueBalance = q.overdueBalance;
        a.totalLoans = q.totalLoans;
        a.defaultedLoansCount = q.defaultedLoansCount;
        a.allTimeRepaid = q.allTimeRepaid;
        a.allTimeExpected = q.allTimeExpected;
      }
    });

    collectionStats.forEach(c => {
      const a = agentMap.get(c._id.toString());
      if (a) a.collections = c.collections;
    });

    // Patterns map for easy lookup
    const patternMap = new Map(patterns.map(p => [p._id.toString(), p.suspiciousBorrowersCount]));

    // 5. Build final response objects & Calculate Risks
    const agentProductivity = [];
    const portfolioQuality = [];
    const operationalBehavior = [];
    const riskFlags = [];
    const leaderboardData = [];

    agentMap.forEach((agent, id) => {
      // Productivity
      agentProductivity.push({
        agentId: id,
        agentName: agent.name,
        loansIssued: agent.loansIssued,
        amountDisbursed: agent.amountDisbursed,
        collections: agent.collections,
        activeClients: agent.activeClients
      });

      // Quality
      const par = agent.totalActiveBalance > 0 ? (agent.overdueBalance / agent.totalActiveBalance) * 100 : 0;
      const defaultRate = agent.totalLoans > 0 ? (agent.defaultedLoansCount / agent.totalLoans) * 100 : 0;
      const collectionEfficiency = agent.allTimeExpected > 0 ? (agent.allTimeRepaid / agent.allTimeExpected) * 100 : 0;

      portfolioQuality.push({
        agentId: id,
        agentName: agent.name,
        par: Number(par.toFixed(2)),
        defaultRate: Number(defaultRate.toFixed(2)),
        overdueAmount: agent.overdueBalance,
        collectionEfficiency: Number(collectionEfficiency.toFixed(2))
      });

      // Risk Flags detection
      const flags = [];
      if (agent.amountDisbursed > 50000 && agent.collections < agent.amountDisbursed * 0.2) {
        flags.push("HIGH_DISBURSE_LOW_COLLECTION");
      }
      if (par > 30) {
        flags.push("HIGH_PAR_DANGER");
      }
      if (patternMap.has(id)) {
        flags.push("UNUSUAL_BORROWER_PATTERN");
      }

      if (flags.length > 0) {
        riskFlags.push({
          agentId: id,
          agentName: agent.name,
          flags
        });
      }

      // Operational
      operationalBehavior.push({
        agentId: id,
        agentName: agent.name,
        lastActivityDate: agent.lastActiveAt,
        loginFrequency: "N/A", // Not tracked in current schema
        suspiciousBehavior: flags.length > 0 ? `Detected ${flags.length} flags` : "None"
      });

      // Leaderboard Score
      // Score = (Collection % * 0.6) + (Productivity Score * 0.4) - (PAR * 0.5)
      const score = (collectionEfficiency * 0.6) + ((agent.loansIssued / 10) * 0.4) - (par * 0.5);
      leaderboardData.push({
        agentId: id,
        agentName: agent.name,
        score: Number(score.toFixed(2)),
        riskFlags: flags
      });
    });

    // Leaderboards
    const topPerforming = [...leaderboardData].sort((a, b) => b.score - a.score).slice(0, 5);
    const underperforming = [...leaderboardData].sort((a, b) => a.score - b.score).slice(0, 5);
    const highRiskAgents = [...leaderboardData].filter(a => a.riskFlags.length > 0).sort((a, b) => b.riskFlags.length - a.riskFlags.length).slice(0, 5);

    return res.json({
      success: true,
      agentProductivity,
      portfolioQuality,
      operationalBehavior,
      riskFlags,
      leaderboards: {
        topPerforming,
        underperforming,
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
    const lenderId = new mongoose.Types.ObjectId(req.user._id);
    const { startDate, endDate } = req.query;

    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(new Date().setDate(new Date().getDate() - 30));

    const duration = end.getTime() - start.getTime();
    const prevStart = new Date(start.getTime() - duration);
    const prevEnd = start;

    const aggResult = await Loan.aggregate([
      {
        $match: {
          lenderId,
          loanRequestStatus: "approved",
          isDeleted: { $ne: true }
        }
      },

      {
        $lookup: {
          from: "customers",
          localField: "borrowerId",
          foreignField: "_id",
          as: "customer"
        }
      },

      { $unwind: "$customer" },

      {
        $project: {
          amount: { $ifNull: ["$amount", 0] },
          balance: { $ifNull: ["$balance", 0] },
          repaidAmount: { $ifNull: ["$repaidAmount", 0] },
          totalRepayment: { $ifNull: ["$totalRepayment", 0] },
          status: 1,
          isDefaulted: 1,
          issueDate: 1,
          requestedByAgentId: 1,
          repayments: 1,

region: {
  $cond: [
    {
      $or: [
        { $eq: ["$customer.town", ""] },
        { $eq: ["$customer.town", null] },
        { $not: ["$customer.town"] }
      ]
    },
    "Other",
    "$customer.town"
  ]
},

          coords: {
            $ifNull: ["$customer.gpsLocation", { lat: 0, lng: 0 }]
          }
        }
      },

      {
        $facet: {

          metrics: [
            {
              $group: {
                _id: "$region",

                totalDisbursed: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $gte: ["$issueDate", start] },
                          { $lte: ["$issueDate", end] }
                        ]
                      },
                      "$amount",
                      0
                    ]
                  }
                },

                prevTotalDisbursed: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $gte: ["$issueDate", prevStart] },
                          { $lte: ["$issueDate", prevEnd] }
                        ]
                      },
                      "$amount",
                      0
                    ]
                  }
                },

                activeLoansCount: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "active"] }, 1, 0]
                  }
                },

                outstandingBalance: { $sum: "$balance" },

                overdueAmount: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "overdue"] }, "$balance", 0]
                  }
                },

                defaultedLoans: {
                  $sum: { $cond: ["$isDefaulted", 1, 0] }
                },

                totalLoansCount: { $sum: 1 },

                uniqueAgents: { $addToSet: "$requestedByAgentId" },

                lat: { $avg: "$coords.lat" },
                lng: { $avg: "$coords.lng" }
              }
            }
          ],

          collections: [
            { $unwind: "$repayments" },

            {
              $match: {
                "repayments.date": { $gte: start, $lte: end }
              }
            },

            {
              $group: {
                _id: "$region",
                collectedInPeriod: { $sum: "$repayments.amount" }
              }
            }
          ]
        }
      }
    ]);

    const metricsData = aggResult[0].metrics;
    const collectionsData = aggResult[0].collections;

    const collectionsMap = {};
    collectionsData.forEach(c => {
      collectionsMap[c._id] = c.collectedInPeriod;
    });

    const regionalPortfolio = [];
    const riskHeatmap = [];
    const operationalEfficiency = [];
    const mapHeatView = [];
    const growthStats = [];

    metricsData.forEach(m => {
      const region = m._id;
      const collections = collectionsMap[region] || 0;

      const par =
        m.outstandingBalance > 0
          ? (m.overdueAmount / m.outstandingBalance) * 100
          : 0;

      const defaultRate =
        m.totalLoansCount > 0
          ? (m.defaultedLoans / m.totalLoansCount) * 100
          : 0;

      const efficiency =
        m.outstandingBalance + collections > 0
          ? (collections / (m.outstandingBalance + collections)) * 100
          : 0;

      const heatScore =
        par * 0.5 + defaultRate * 0.3 + (100 - efficiency) * 0.2;

      let riskLevel = "Minimal";
      if (heatScore > 30) riskLevel = "Critical";
      else if (heatScore > 20) riskLevel = "High";
      else if (heatScore > 10) riskLevel = "Moderate";

      regionalPortfolio.push({
        region,
        totalDisbursed: m.totalDisbursed,
        activeLoans: m.activeLoansCount,
        outstandingBalance: m.outstandingBalance,
        collections
      });

      riskHeatmap.push({
        region,
        par: Number(par.toFixed(2)),
        defaultRate: Number(defaultRate.toFixed(2)),
        overdueAmount: m.overdueAmount,
        heatScore: Number(heatScore.toFixed(2))
      });

      operationalEfficiency.push({
        region,
        agents: m.uniqueAgents.length,
        revenue: collections,
        collectionEfficiency: Number(efficiency.toFixed(2))
      });

      mapHeatView.push({
        region,
        lat: m.lat || 0,
        lng: m.lng || 0,
        heatScore: Number(heatScore.toFixed(2)),
        riskLevel
      });

      const growthRate =
        m.prevTotalDisbursed > 0
          ? ((m.totalDisbursed - m.prevTotalDisbursed) /
              m.prevTotalDisbursed) *
            100
          : m.totalDisbursed > 0
          ? 100
          : 0;

      growthStats.push({
        region,
        growthRate: Number(growthRate.toFixed(1)),
        isNewMarket: m.prevTotalDisbursed === 0 && m.totalDisbursed > 0,
        currentVolume: m.totalDisbursed
      });
    });

    const growthIndicators = {
      fastestGrowingRegions: growthStats
        .filter(g => g.growthRate > 0)
        .sort((a, b) => b.growthRate - a.growthRate)
        .slice(0, 5),

      decliningRegions: growthStats
        .filter(g => g.growthRate < 0)
        .sort((a, b) => a.growthRate - b.growthRate)
        .slice(0, 5),

      newMarketPerformance: growthStats.filter(g => g.isNewMarket)
    };

    res.json({
      success: true,
      regionalPortfolio,
      riskHeatmap,
      growthIndicators,
      operationalEfficiency,
      mapHeatView
    });

  } catch (error) {
    console.error("Region report error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


exports.getBusinessTypeLoanReport = async (req, res) => {
  try {
    const lenderId = new mongoose.Types.ObjectId(req.user._id);
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date(0);
    const end = endDate ? new Date(endDate) : new Date();

    const aggResult = await Loan.aggregate([
      {
        $match: {
          lenderId,
          loanRequestStatus: "approved",
          isDeleted: { $ne: true },
          issueDate: { $gte: start, $lte: end }
        }
      },
      {
        $lookup: {
          from: "customers",
          localField: "borrowerId",
          foreignField: "_id",
          as: "customer"
        }
      },
      { $unwind: "$customer" },
      {
        $project: {
          amount: 1,
          balance: 1,
          status: 1,
          isDefaulted: 1,
          issueDate: 1,
          dueDate: 1,
          repaidAmount: 1,
          totalRepayment: 1,
          dailyRepayment: 1,
          repayments: 1,
businessType: {
 $trim:{
  input:{
   $ifNull:[
     "$customer.businessType",
     { $ifNull:["$customer.occupation","Other"] }
   ]
  }
 }
},
          demographics: {
            maritalStatus: { $ifNull: ["$customer.maritalStatus", "Unknown"] },
            educationLevel: { $ifNull: ["$customer.educationLevel", "Unknown"] },
            householdSize: { $ifNull: ["$customer.householdSize", 0] },
            urbanRural: {
              $cond: [
                { 
                  $regexMatch: { 
                    input: { $ifNull: ["$customer.physicalAddress", ""] }, 
                    regex: /city|urban|nairobi|mombasa|kisumu|nakuru|kampala|dar|lagos|accra|kigali/i 
                  } 
                },
                "Urban", 
                "Rural"
              ]
            }
          }
        }
      },
      {
        $facet: {
          main: [
            {
              $group: {
                _id: "$businessType",
                issuedLoans: { $sum: 1 },
                totalDisbursed: { $sum: "$amount" },
                activeLoans: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
                completedLoans: { $sum: { $cond: [{ $eq: ["$status", "fully paid"] }, 1, 0] } },
                defaultedLoans: { $sum: { $cond: ["$isDefaulted", 1, 0] } },
                portfolioBalance: { $sum: "$balance" },
                overdueBalance: { $sum: { $cond: [{ $eq: ["$status", "overdue"] }, "$balance", 0] } },
                totalRepaid: { $sum: "$repaidAmount" },
                totalExpected: { $sum: "$totalRepayment" },
                nearingDueCount: {
                   $sum: {
                     $cond: [
                       { 
                         $and: [
                           { $gt: ["$balance", 0] },
                           { $gte: ["$dueDate", new Date()] },
                           { $lte: ["$dueDate", new Date(new Date().setDate(new Date().getDate() + 7))] }
                         ] 
                       },
                       1,
                       0
                     ]
                   }
                }
              }
            }
          ],
          behavior: [
            { $unwind: "$repayments" },
            {
              $group: {
                _id: "$businessType",
                onTimeCount: { $sum: { $cond: [{ $eq: ["$repayments.wasPaymentLate", false] }, 1, 0] } },
                lateCount: { $sum: { $cond: [{ $eq: ["$repayments.wasPaymentLate", true] }, 1, 0] } },
                totalDaysLate: { $sum: { $ifNull: ["$repayments.daysLate", 0] } },
                partialCount: { $sum: { $cond: [{ $lt: ["$repayments.amount", "$dailyRepayment"] }, 1, 0] } },
                fullCount: { $sum: { $cond: [{ $gte: ["$repayments.amount", "$dailyRepayment"] }, 1, 0] } }
              }
            }
          ],
          demographics_marital: [
            { $group: { _id: { businessType: "$businessType", value: "$demographics.maritalStatus" }, count: { $sum: 1 } } }
          ],
          demographics_education: [
            { $group: { _id: { businessType: "$businessType", value: "$demographics.educationLevel" }, count: { $sum: 1 } } }
          ],
          demographics_urbanRural: [
            { $group: { _id: { businessType: "$businessType", value: "$demographics.urbanRural" }, count: { $sum: 1 } } }
          ]
        }
      }
    ]);

    const { main, behavior, demographics_marital, demographics_education, demographics_urbanRural } = aggResult[0];

    const behaviorMap = behavior.reduce((acc, b) => { acc[b._id] = b; return acc; }, {});

    const businessMetrics = main.map(m => ({
      businessType: m._id,
      issuedLoans: m.issuedLoans,
      totalDisbursed: m.totalDisbursed,
      averageLoanSize: m.issuedLoans > 0 ? Number((m.totalDisbursed / m.issuedLoans).toFixed(2)) : 0,
      activeLoans: m.activeLoans,
      completedLoans: m.completedLoans,
      defaultedLoans: m.defaultedLoans,
      restructuredLoans: 0
    }));

    const riskIndicators = main.map(m => ({
      businessType: m._id,
      par: m.portfolioBalance > 0 ? Number(((m.overdueBalance / m.portfolioBalance) * 100).toFixed(2)) : 0,
      defaultRate: m.issuedLoans > 0 ? Number(((m.defaultedLoans / m.issuedLoans) * 100).toFixed(2)) : 0,
      loansNearingDueDate: m.nearingDueCount
    }));

    const borrowerBehavior = main.map(m => {
      const b = behaviorMap[m._id] || {};
      return {
        businessType: m._id,
        repaymentRate: m.totalExpected > 0 ? Number(((m.totalRepaid / m.totalExpected) * 100).toFixed(2)) : 0,
        onTimeRepayments: b.onTimeCount || 0,
        lateRepayments: b.lateCount || 0,
        averageDaysLate: b.lateCount > 0 ? Number((b.totalDaysLate / b.lateCount).toFixed(1)) : 0,
        partialRepayments: b.partialCount || 0,
        fullRepayments: b.fullCount || 0
      };
    });

    const demographicInsights = main.map(m => {
      const bType = m._id;
      return {
        businessType: bType,
        maritalBreakdown: demographics_marital.filter(x => x._id.businessType === bType).map(x => ({ type: x._id.value, count: x.count })),
        educationBreakdown: demographics_education.filter(x => x._id.businessType === bType).map(x => ({ type: x._id.value, count: x.count })),
        urbanRuralBreakdown: demographics_urbanRural.filter(x => x._id.businessType === bType).map(x => ({ type: x._id.value, count: x.count }))
      };
    });

    res.json({
      success: true,
      businessMetrics,
      borrowerBehavior,
      riskIndicators,
      demographicInsights
    });

  } catch (err) {
    console.error("Business type report error:", err);
    res.status(500).json({ success: false, message: err.message });
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
    const { startDate, endDate } = req.query;

    const startObj = startDate ? new Date(startDate) : null;
    const endObj = endDate ? new Date(endDate) : new Date();

    // 1. Get agents for this lender to filter customers
    const agents = await Agent.find({ lenderId }).select("_id").lean();
    const agentIds = agents.map(a => a._id);

    const borrowerMatch = {
      $and: [
        {
          $or: [
            { registeredBy: new mongoose.Types.ObjectId(lenderId), registeredByModel: "User" },
            { agentId: { $in: agentIds } },
            { assignedAgent: { $in: agentIds } }
          ]
        },
        { isDeleted: { $ne: true } }
      ]
    };

    // 2. Aggregate Demographics & Geographic Insights
    const demographicsData = await Customer.aggregate([
      { $match: borrowerMatch },
      {
        $facet: {
          ageGroup: [
            {
              $addFields: {
                age: {
                  $divide: [
                    { $subtract: [new Date(), "$dateOfBirth"] },
                    1000 * 60 * 60 * 24 * 365
                  ]
                }
              }
            },
            {
              $group: {
                _id: {
                  $switch: {
                    branches: [
                      { case: { $lt: ["$age", 26] }, then: "18-25" },
                      { case: { $lt: ["$age", 36] }, then: "26-35" },
                      { case: { $lt: ["$age", 46] }, then: "36-45" },
                      { case: { $lt: ["$age", 61] }, then: "46-60" },
                      { case: { $gte: ["$age", 61] }, then: "60+" }
                    ],
                    default: "Unknown"
                  }
                },
                count: { $sum: 1 }
              }
            }
          ],
          gender: [
            { $group: { _id: { $ifNull: ["$gender", "Unknown"] }, count: { $sum: 1 } } }
          ],
          occupation: [
            { $group: { _id: { $ifNull: ["$occupation", "Unknown"] }, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
          ],
          income: [
            { $group: { _id: { $ifNull: ["$monthlyIncomeRange", "Unknown"] }, count: { $sum: 1 } } }
          ],
          regional: [
            { $group: { _id: { $ifNull: ["$town", "Unknown"] }, count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ],
          urbanRural: [
            {
              $group: {
                _id: {
                  $cond: [
                    { 
                      $regexMatch: { 
                        input: { $ifNull: ["$physicalAddress", ""] }, 
                        regex: /city|urban|nairobi|mombasa|kisumu|nakuru|kampala|dar|lagos|accra|kigali/i 
                      } 
                    },
                    "Urban", 
                    "Rural"
                  ]
                },
                count: { $sum: 1 }
              }
            }
          ],
          growth: [
            {
              $match: {
                createdAt: { $gte: startObj || new Date(0), $lte: endObj }
              }
            },
            {
              $group: {
                _id: { $ifNull: ["$town", "Unknown"] },
                newBorrowers: { $sum: 1 }
              }
            }
          ]
        }
      }
    ]);

    // 3. Aggregate Behavior Patterns by Demographic Segments
    const behaviorData = await Loan.aggregate([
      {
        $match: {
          lenderId: new mongoose.Types.ObjectId(lenderId),
          loanRequestStatus: "approved",
          isDeleted: { $ne: true }
        }
      },
      {
        $lookup: {
          from: "customers",
          localField: "borrowerId",
          foreignField: "_id",
          as: "borrower"
        }
      },
      { $unwind: "$borrower" },
      {
        $facet: {
          byGender: [
            {
              $group: {
                _id: { $ifNull: ["$borrower.gender", "Unknown"] },
                avgLoanSize: { $avg: "$amount" },
                defaultRatePercentage: { $avg: { $cond: ["$isDefaulted", 1, 0] } },
                repaymentRatePercentage: { 
                  $avg: { 
                    $cond: [
                      { $gt: ["$totalRepayment", 0] }, 
                      { $divide: ["$repaidAmount", "$totalRepayment"] }, 
                      0
                    ] 
                  } 
                }
              }
            }
          ],
          byEducation: [
            {
              $group: {
                _id: { $ifNull: ["$borrower.educationLevel", "Unknown"] },
                count: { $sum: 1 },
                avgLoanSize: { $avg: "$amount" },
                defaultRatePercentage: { $avg: { $cond: ["$isDefaulted", 1, 0] } },
                repaymentRatePercentage: { 
                  $avg: { 
                    $cond: [
                      { $gt: ["$totalRepayment", 0] }, 
                      { $divide: ["$repaidAmount", "$totalRepayment"] }, 
                      0
                    ] 
                  } 
                }
              }
            }
          ],
          byMarital: [
            {
              $group: {
                _id: { $ifNull: ["$borrower.maritalStatus", "Unknown"] },
                count: { $sum: 1 },
                defaultRatePercentage: { $avg: { $cond: ["$isDefaulted", 1, 0] } },
                repaymentRatePercentage: { 
                  $avg: { 
                    $cond: [
                      { $gt: ["$totalRepayment", 0] }, 
                      { $divide: ["$repaidAmount", "$totalRepayment"] }, 
                      0
                    ] 
                  } 
                }
              }
            }
          ]
        }
      }
    ]);

    // 4. Transform & Format Response
    const d = demographicsData[0] || {};
    const b = behaviorData[0] || {};

    const formatToObj = (arr) => (arr || []).reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {});

    const customerDemographics = {
      ageDistribution: formatToObj(d.ageGroup),
      genderDistribution: formatToObj(d.gender),
      occupationDistribution: formatToObj(d.occupation),
      incomeBands: formatToObj(d.income)
    };

    const geographicInsights = {
      borrowersByRegion: formatToObj(d.regional),
      urbanRuralSplit: formatToObj(d.urbanRural),
      borrowerGrowthByLocation: (d.growth || []).reduce((acc, curr) => {
        acc[curr._id] = curr.newBorrowers;
        return acc;
      }, {})
    };

    const behaviorPatterns = {
      byGender: (b.byGender || []).map(item => ({
        segment: item._id,
        avgLoanSize: Math.round(item.avgLoanSize || 0),
        defaultRate: Number(((item.defaultRatePercentage || 0) * 100).toFixed(2)),
        repaymentRate: Number(((item.repaymentRatePercentage || 0) * 100).toFixed(2))
      })),
      byEducation: (b.byEducation || []).map(item => ({
        level: item._id,
        count: item.count,
        avgLoanSize: Math.round(item.avgLoanSize || 0),
        defaultRate: Number(((item.defaultRatePercentage || 0) * 100).toFixed(2)),
        repaymentRate: Number(((item.repaymentRatePercentage || 0) * 100).toFixed(2))
      })),
      byMaritalStatus: (b.byMarital || []).map(item => ({
        status: item._id,
        count: item.count,
        defaultRate: Number(((item.defaultRatePercentage || 0) * 100).toFixed(2)),
        repaymentRate: Number(((item.repaymentRatePercentage || 0) * 100).toFixed(2))
      }))
    };

    // Market Opportunities Logic
    const underservedRegions = (d.regional || [])
      .filter(r => r.count < 5)
      .map(r => r._id);

    const fastGrowingSegments = (d.growth || [])
      .sort((a, b) => b.newBorrowers - a.newBorrowers)
      .slice(0, 3)
      .map(s => s._id);

    const highRiskDemographics = (b.byGender || [])
      .filter(g => (g.defaultRatePercentage || 0) > 0.2)
      .map(g => `${g._id} Borrowers`)
      .concat(
        (b.byEducation || []).filter(e => (e.defaultRatePercentage || 0) > 0.2).map(e => `${e._id} Education Level`)
      );

    const marketOpportunities = {
      underservedRegions,
      fastGrowingSegments,
      highRiskDemographics
    };

    return res.json({
      success: true,
      customerDemographics,
      geographicInsights,
      behaviorPatterns,
      marketOpportunities
    });

  } catch (error) {
    console.error("Demographics Analysis Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate demographics analysis",
      error: error.message
    });
  }
};


