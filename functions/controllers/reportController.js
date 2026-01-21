const Loan = require("../models/Loan");
const Customer = require("../models/customer");
const Transaction = require("../models/Transaction");
const Agent = require("../models/AgentModel");

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

  res.json({ success: true, data });
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
