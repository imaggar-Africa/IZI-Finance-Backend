const Stats = require('../models/Stats');
const Loan = require("../models/Loan")
// ✅ Fetch real-time stats from Loan collection
exports.getStats = async (req, res) => {
  try {
    /* ----------------------------------------------------
     * DATE CALCULATIONS
     * -------------------------------------------------- */
    const now = new Date();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Last 7 days (including today)
    const last7DaysStart = new Date();
    last7DaysStart.setDate(now.getDate() - 6);
    last7DaysStart.setHours(0, 0, 0, 0);

    // This month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Last 3 months (rolling)
    const last3MonthsStart = new Date();
    last3MonthsStart.setMonth(now.getMonth() - 2);
    last3MonthsStart.setDate(1);
    last3MonthsStart.setHours(0, 0, 0, 0);

    /* ----------------------------------------------------
     * GLOBAL LOAN COUNTS (ISSUED)
     * -------------------------------------------------- */
    const totalLoansIssued = await Loan.countDocuments();
    const activeLoans = await Loan.countDocuments({ status: "active" });
    const overdueLoans = await Loan.countDocuments({ status: "overdue" });
    const paidLoans = await Loan.countDocuments({ status: "fully paid" });

    /* ----------------------------------------------------
     * HELPER: ISSUED LOANS BY PERIOD
     * -------------------------------------------------- */
    const buildIssuedLoanStats = async (startDate) => {
      const loans = await Loan.find({
        createdAt: { $gte: startDate }
      }).populate("borrowerId");

      return {
        count: loans.length,
        totalAmount: loans.reduce((sum, l) => sum + (l.amount || 0), 0),
        loans
      };
    };

    /* ----------------------------------------------------
     * PERIOD-BASED ISSUED LOANS
     * -------------------------------------------------- */
    const last7DaysLoansIssued = await buildIssuedLoanStats(last7DaysStart);

    const thisMonthLoansIssued = await buildIssuedLoanStats(startOfMonth);

    const last3MonthsLoansIssued = await buildIssuedLoanStats(last3MonthsStart);

    /* ----------------------------------------------------
     * RESPONSE (CLEAN & FOCUSED)
     * -------------------------------------------------- */
    res.json({
      success: true,

      totals: {
        totalLoansIssued,
        activeLoans,
        overdueLoans,
        paidLoans
      },

      issuedLoans: {
        last7Days: last7DaysLoansIssued,
        thisMonth: thisMonthLoansIssued,
        last3Months: last3MonthsLoansIssued
      }
    });

  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ message: "Server error", error });
  }
};



