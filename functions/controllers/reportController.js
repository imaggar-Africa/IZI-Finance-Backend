const Loan = require("../models/Loan");
const Customer = require("../models/customer");
const Transaction = require("../models/Transaction");
const Agent = require("../models/AgentModel");
const { logReportAudit } = require("../utils/auditLogger");
const AuditLog = require("../models/AuditLog");
const mongoose = require("mongoose");

/* ===========================
   DASHBOARD REPORT
=========================== */
exports.getDashboardReport = async (req, res) => {
  try {
    const totalLoans = await Loan.countDocuments();
    const activeLoans = await Loan.countDocuments({ status: "active" });
    const overdueLoans = await Loan.countDocuments({ status: "overdue" });
    const defaultedLoans = await Loan.countDocuments({ isDefaulted: true });

    const loans = await Loan.find();

    const totalDisbursed = loans.reduce((s, l) => s + l.amount, 0);
    const totalOutstanding = loans.reduce((s, l) => s + l.balance, 0);
    const totalRepaid = loans.reduce((s, l) => s + l.repaidAmount, 0);

    await logReportAudit({
      req,
      reportType: "DASHBOARD_REPORT"
    });


    res.json({
      success: true,
      summary: {
        totalLoans,
        activeLoans,
        overdueLoans,
        defaultedLoans,
        totalDisbursed,
        totalOutstanding,
        totalRepaid
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ===========================
   LOANS REPORT
=========================== */
exports.getLoansReport = async (req, res) => {
  const loans = await Loan.find().populate("borrowerId lenderId");

   await logReportAudit({
    req,
    reportType: "LOANS_REPORT"
  });

  res.json({
    success: true,
    summary: {
      count: loans.length,
      totalAmount: loans.reduce((s, l) => s + l.amount, 0),
      totalInterest: loans.reduce((s, l) => s + l.interest, 0)
    },
    data: loans
  });
};

/* ===========================
   REPAYMENTS REPORT
=========================== */
exports.getRepaymentsReport = async (req, res) => {
  const repayments = await Transaction.find({ type: "repayment" });
   await logReportAudit({
    req,
    reportType: "REPAYMENTS_REPORT"
  });


  res.json({
    success: true,
    summary: {
      totalRepaid: repayments.reduce((s, r) => s + r.amount, 0),
      count: repayments.length
    },
    data: repayments
  });
};

/* ===========================
   PROFIT & INTEREST REPORT
=========================== */
exports.getProfitReport = async (req, res) => {
  const loans = await Loan.find();

  const interestExpected = loans.reduce((s, l) => s + l.interest, 0);
  const interestCollected = loans.reduce(
    (s, l) => s + Math.max(0, l.repaidAmount - l.amount),
    0
  );

  await logReportAudit({
    req,
    reportType: "PROFIT_REPORT"
  });

  res.json({
    success: true,
    summary: {
      interestExpected,
      interestCollected,
      netProfit: interestCollected
    }
  });
};

/* ===========================
   BORROWERS REPORT
=========================== */
exports.getBorrowersReport = async (req, res) => {
  const borrowers = await Customer.find();

  const data = await Promise.all(
    borrowers.map(async (b) => {
      const loan = await Loan.findOne({ borrowerId: b._id }).sort({ createdAt: -1 });

      const creditScore = b.creditScore || 500;
      const rating = +(creditScore / 1000).toFixed(2);

      return {
        borrowerId: b._id,
        fullName: b.fullName,
        creditScore,
        rating,
        activeLoanBalance: loan ? loan.balance : 0,
        isDefaulted: loan ? loan.isDefaulted : false
      };
    })
  );

   await logReportAudit({
    req,
    reportType: "BORROWERS_REPORT"
  });

  res.json({
    success: true,
    count: data.length,
    data
  });
};

/* ===========================
   AGENTS REPORT
=========================== */
exports.getAgentsReport = async (req, res) => {
  const agents = await Agent.find();

  const data = await Promise.all(
    agents.map(async (a) => {
      const loans = await Loan.find({ requestedByAgentId: a._id });

      return {
        agentId: a._id,
        name: a.fullName,
        loansHandled: loans.length,
        totalDisbursed: loans.reduce((s, l) => s + l.amount, 0)
      };
    })
  );

   await logReportAudit({
    req,
    reportType: "AGENTS_REPORT"
  });

  res.json({ success: true, data });
};

/* ===========================
   AUDIT LOGS (BASIC)
=========================== */
exports.getAuditLogs = async (req, res) => {
  const logs = await AuditLog.find()
    .sort({ createdAt: -1 })
    .limit(50);

  res.json({
    success: true,
    count: logs.length,
    data: logs
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

await logReportAudit({
  req,
  reportType: "LOAN_REPAYMENT_REPORT",
  filters: {
    borrowerId: borrowerId || "ALL",
    loanId: loanId || "ALL",
    fromDate: fromDate || null,
    toDate: toDate || null
  }
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
   DEMOGRAPHICS REPORT
=========================== */
exports.getDemographicsReport = async (req, res) => {
  try {
    const data = await mongoose.connection.db
      .collection("demographics_repayment_analysis")
      .find({})
      .toArray();

    try {
      await logReportAudit({
        req,
        reportType: "DEMOGRAPHICS_REPORT",
        filters: { source: "VIEW" }
      });
    } catch (e) {}

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


/* ===========================
   REGIONAL PERFORMANCE REPORT
=========================== */
exports.getRegionalPerformanceReport = async (req, res) => {
  try {
    const data = await mongoose.connection.db
      .collection("regional_market_performance")
      .find({})
      .toArray();

    try {
      await logReportAudit({
        req,
        reportType: "REGIONAL_PERFORMANCE_REPORT",
        filters: { source: "VIEW" }
      });
    } catch (e) {
      console.error("Audit log failed:", e.message);
    }

    res.json({
      success: true,
      basedOn: "DB VIEW: regional_market_performance",
      data
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};




/* ===========================
   BUSINESS TYPE REPORT
=========================== */
exports.getBusinessTypeReport = async (req, res) => {
  try {
    const data = await mongoose.connection.db
      .collection("business_category_performance")
      .find({})
      .toArray();

    try {
      await logReportAudit({
        req,
        reportType: "BUSINESS_TYPE_REPORT",
        filters: { source: "VIEW" }
      });
    } catch (e) {}

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


