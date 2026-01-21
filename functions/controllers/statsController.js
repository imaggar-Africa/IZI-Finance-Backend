const Stats = require('../models/Stats');
const Loan = require("../models/Loan");

// ✅ Fetch real-time stats from Loan collection
exports.getStats = async (req, res) => {
  try {
    const now = new Date();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date(startOfToday);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const threeMonthsAgo = new Date(startOfMonth);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    /* ================= ALL APPROVED LOANS ================= */
    const loans = await Loan.find({
      loanRequestStatus: "approved"
    }).populate("borrowerId", "fullName phone");

    /* ================= GLOBAL TOTALS ================= */
    let totalLoanAmount = 0;
    let totalCollectedAmount = 0;
    let outstandingLoanAmount = 0;
    let activeLoans = 0;
    let overdueLoans = 0;
    let paidLoans = 0;

    loans.forEach((loan) => {
      totalLoanAmount += loan.totalRepayment || 0;

      const collected = loan.repayments?.reduce(
        (sum, r) => sum + (r.amount || 0),
        0
      ) || 0;

      totalCollectedAmount += collected;
      outstandingLoanAmount += loan.balance || 0;

      if (loan.balance > 0) {
        activeLoans++;
        if (new Date(loan.dueDate) < now) {
          overdueLoans++;
        }
      } else {
        paidLoans++; // ✅ fully paid loans
      }
    });

    /* ================= FILTERED LOANS ================= */
    const last7DaysLoans = loans.filter(
      l => l.createdAt >= sevenDaysAgo
    );

    const thisMonthLoans = loans.filter(
      l => l.createdAt >= startOfMonth
    );

    const last3MonthsLoans = loans.filter(
      l => l.createdAt >= threeMonthsAgo
    );

    /* ================= ISSUED LOANS ================= */
    const issuedLoans = {
      last7Days: {
        count: last7DaysLoans.length,
        totalAmount: last7DaysLoans.reduce(
          (s, l) => s + (l.totalRepayment || 0),
          0
        ),
        loans: last7DaysLoans
      },
      thisMonth: {
        count: thisMonthLoans.length,
        totalAmount: thisMonthLoans.reduce(
          (s, l) => s + (l.totalRepayment || 0),
          0
        ),
        loans: thisMonthLoans
      },
      last3Months: {
        count: last3MonthsLoans.length,
        totalAmount: last3MonthsLoans.reduce(
          (s, l) => s + (l.totalRepayment || 0),
          0
        ),
        loans: last3MonthsLoans
      }
    };

    /* ================= FINAL RESPONSE ================= */
    res.status(200).json({
      totalLoanCount: loans.length,      // ✅ added
      totalLoanAmount,
      totalCollectedAmount,
      outstandingLoanAmount,
      activeLoans,
      overdueLoans,
      paidLoans,                         // ✅ added
      issuedLoans
    });

  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ message: "Server error" });
  }
};
