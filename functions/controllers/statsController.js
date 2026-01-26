const Stats = require('../models/Stats');
const Loan = require("../models/Loan");
const PDFDocument = require("pdfkit");

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

exports.downloadStatsPDF = async (req, res) => {
  try {
    const now = new Date();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date(startOfToday);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const threeMonthsAgo = new Date(startOfMonth);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    /* ================= FETCH APPROVED LOANS ================= */
    const loans = await Loan.find({
      loanRequestStatus: "approved"
    }).populate("borrowerId", "fullName phone");

    /* ================= CALCULATIONS ================= */
    let totalLoanAmount = 0;
    let totalPrincipalAmount = 0;
    let totalCollectedAmount = 0;
    let outstandingLoanAmount = 0;
    let activeLoans = 0;
    let overdueLoans = 0;
    let paidLoans = 0;
    let totalInterestEarned = 0;

    loans.forEach((loan) => {
      totalLoanAmount += loan.totalRepayment || 0;
      totalPrincipalAmount += loan.amount || 0;
      outstandingLoanAmount += loan.balance || 0;

      const collected = Array.isArray(loan.repayments)
        ? loan.repayments.reduce((s, r) => s + (r.amount || 0), 0)
        : 0;

      totalCollectedAmount += collected;

      const principalRecovered = Math.min(collected, loan.amount || 0);
      const interestRecovered = Math.max(0, collected - principalRecovered);
      totalInterestEarned += interestRecovered;

      if (loan.balance > 0) {
        activeLoans++;
        if (new Date(loan.dueDate) < now) overdueLoans++;
      } else {
        paidLoans++;
      }
    });

    /* ================= CREATE PDF ================= */
    const doc = new PDFDocument({ size: "A4", margin: 50 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="lender-stats-report.pdf"'
    );

    doc.pipe(res);

    /* ================= PDF CONTENT ================= */
    doc
      .fontSize(20)
      .text("IZI Lender App – Stats Report", { align: "center" })
      .moveDown(1);

    doc
      .fontSize(12)
      .text(`Generated On: ${now.toLocaleString()}`)
      .moveDown(1.5);

    doc.fontSize(14).text("Overall Statistics", { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(11);
    doc.text(`Total Loans Approved: ${loans.length}`);
    doc.text(`Total Principal Amount: ₹${totalPrincipalAmount.toFixed(2)}`);
    doc.text(`Total Loan Amount (With Interest): ₹${totalLoanAmount.toFixed(2)}`);
    doc.text(`Total Collected Amount: ₹${totalCollectedAmount.toFixed(2)}`);
    doc.text(`Total Interest Earned: ₹${totalInterestEarned.toFixed(2)}`);
    doc.text(`Outstanding Loan Amount: ₹${outstandingLoanAmount.toFixed(2)}`);
    doc.moveDown(1);

    doc.fontSize(14).text("Loan Status Breakdown", { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(11);
    doc.text(`Active Loans: ${activeLoans}`);
    doc.text(`Overdue Loans: ${overdueLoans}`);
    doc.text(`Paid Loans: ${paidLoans}`);

    doc.moveDown(2);
    doc
      .fontSize(10)
      .text("© IZI Lender App", { align: "center" });

    doc.end();

  } catch (error) {
    console.error("PDF download error:", error);
    res.status(500).json({ message: "Failed to generate PDF" });
  }
};