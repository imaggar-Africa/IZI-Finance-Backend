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
    let totalLoanAmount = 0;          // principal + interest (expected)
    let totalPrincipalAmount = 0;     // principal only
    let totalCollectedAmount = 0;     // actual collected
    let outstandingLoanAmount = 0;
    let activeLoans = 0;
    let overdueLoans = 0;
    let paidLoans = 0;
    let totalInterestEarned = 0;      // ✅ FIXED (positive only)

    loans.forEach((loan) => {
      totalLoanAmount += loan.totalRepayment || 0;
      totalPrincipalAmount += loan.amount || 0;
      outstandingLoanAmount += loan.balance || 0;

      const collected = Array.isArray(loan.repayments)
        ? loan.repayments.reduce((sum, r) => sum + (r.amount || 0), 0)
        : 0;

      totalCollectedAmount += collected;

      /* ================= CORRECT INTEREST CALCULATION =================
         Principal is recovered first.
         Interest is earned ONLY after principal recovery.
      ================================================================= */
      const principalRecovered = Math.min(collected, loan.amount || 0);
      const interestRecovered = Math.max(0, collected - principalRecovered);

      totalInterestEarned += interestRecovered;

      /* ================= STATUS COUNTS ================= */
      if (loan.balance > 0) {
        activeLoans++;
        if (new Date(loan.dueDate) < now) {
          overdueLoans++;
        }
      } else {
        paidLoans++;
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
      totalLoanCount: loans.length,
      totalLoanAmount,
      totalPrincipalAmount,
      totalCollectedAmount,
      totalInterestEarned,          // ✅ ALWAYS POSITIVE
      outstandingLoanAmount,
      activeLoans,
      overdueLoans,
      paidLoans,
      issuedLoans
    });

  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ message: "Server error" });
  }
};
