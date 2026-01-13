const Stats = require('../models/Stats');
const Loan = require("../models/Loan")
// ✅ Fetch real-time stats from Loan collection
exports.getStats = async (req, res) => {
  try {
    /* -------------------------------------------------
       🟢 STEP 1: GLOBAL STATS (FROM DB)
    ------------------------------------------------- */
    const stats = await Stats.findOne();

    /* -------------------------------------------------
       🟢 STEP 2: DATE RANGES
    ------------------------------------------------- */
    const now = new Date();

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date(startOfToday);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const threeMonthsAgo = new Date(startOfMonth);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    /* -------------------------------------------------
       🆕 STEP 3: FETCH ISSUED LOAN DETAILS (LIVE)
    ------------------------------------------------- */
    const [
      last7DaysLoans,
      thisMonthLoans,
      last3MonthsLoans
    ] = await Promise.all([
      Loan.find({
        createdAt: { $gte: sevenDaysAgo },
        loanRequestStatus: "approved"
      })
        .populate("borrowerId", "fullName phone")
        .sort({ createdAt: -1 }),

      Loan.find({
        createdAt: { $gte: startOfMonth },
        loanRequestStatus: "approved"
      })
        .populate("borrowerId", "fullName phone")
        .sort({ createdAt: -1 }),

      Loan.find({
        createdAt: { $gte: threeMonthsAgo },
        loanRequestStatus: "approved"
      })
        .populate("borrowerId", "fullName phone")
        .sort({ createdAt: -1 })
    ]);

    /* -------------------------------------------------
   🆕 STEP 3.1: OUTSTANDING LOAN AMOUNT
------------------------------------------------- */
const outstandingLoans = await Loan.find({
  loanRequestStatus: "approved",
  status: { $in: ["active", "overdue"] }
}).select("balance");

const outstandingLoanAmount = outstandingLoans.reduce(
  (sum, loan) => sum + (loan.balance || 0),
  0
);

    /* -------------------------------------------------
       🆕 STEP 4: FORMAT ISSUED LOANS
    ------------------------------------------------- */
    const issuedLoans = {
      last7Days: {
        count: last7DaysLoans.length,
        totalAmount: last7DaysLoans.reduce((s, l) => s + (l.amount || 0), 0),
        loans: last7DaysLoans
      },
      thisMonth: {
        count: thisMonthLoans.length,
        totalAmount: thisMonthLoans.reduce((s, l) => s + (l.amount || 0), 0),
        loans: thisMonthLoans
      },
      last3Months: {
        count: last3MonthsLoans.length,
        totalAmount: last3MonthsLoans.reduce((s, l) => s + (l.amount || 0), 0),
        loans: last3MonthsLoans
      }
    };

    /* -------------------------------------------------
       ✅ STEP 5: FINAL RESPONSE (MERGED)
    ------------------------------------------------- */
    res.status(200).json({
      ...(stats ? stats.toObject() : {}),
      outstandingLoanAmount,
      issuedLoans
    });

  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ message: "Server error", error });
  }
};






