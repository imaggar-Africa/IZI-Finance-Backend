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
    const { fromDate, toDate } = req.query;

    /* ================= DATE FILTER ================= */
    const loanFilter = {
      loanRequestStatus: "approved"
    };

    if (fromDate || toDate) {
      loanFilter.issueDate = {};
      if (fromDate) loanFilter.issueDate.$gte = new Date(fromDate);
      if (toDate) loanFilter.issueDate.$lte = new Date(toDate);
    }

    /* ================= FETCH APPROVED LOANS ================= */
    const loans = await Loan.find(loanFilter)
      .populate("borrowerId", "fullName phone");

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

    /* ================= PAGE 1 – SUMMARY ================= */

    doc
      .fontSize(20)
      .text("IZI Lender App – Stats Report", { align: "center" })
      .moveDown(1);

    doc
      .fontSize(12)
      .text(`Generated On: ${now.toLocaleString()}`)
      .moveDown(0.5);

    if (fromDate || toDate) {
      doc
        .fontSize(11)
        .text(
          `Report Period: ${
            fromDate ? new Date(fromDate).toDateString() : "Start"
          } → ${
            toDate ? new Date(toDate).toDateString() : "Today"
          }`
        )
        .moveDown(1);
    }

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
    doc.fontSize(10).text("© IZI Lender App", { align: "center" });

    /* ================= PAGE 2 – LOAN DETAILS ================= */

    doc.addPage();

    doc.fontSize(16).text("Loan Details", { underline: true });
    doc.moveDown(1);

    doc.fontSize(10).text(
      "Borrower | Phone | Principal | Total | Collected | Balance | Issue Date | Due Date | Status"
    );
    doc.moveDown(0.5);

    doc.fontSize(9);

    loans.forEach((loan, index) => {
      const borrowerName = loan.borrowerId?.fullName || "N/A";
      const phone = loan.borrowerId?.phone || "N/A";

      const collected = Array.isArray(loan.repayments)
        ? loan.repayments.reduce((s, r) => s + (r.amount || 0), 0)
        : 0;

      let status = "Paid";
      if (loan.balance > 0 && new Date(loan.dueDate) < now) status = "Overdue";
      else if (loan.balance > 0) status = "Active";

      doc.text(
        `${index + 1}. ${borrowerName} | ${phone} | ₹${loan.amount} | ₹${loan.totalRepayment} | ₹${collected} | ₹${loan.balance} | ${
          loan.issueDate ? new Date(loan.issueDate).toDateString() : "N/A"
        } | ${
          loan.dueDate ? new Date(loan.dueDate).toDateString() : "N/A"
        } | ${status}`
      );

      doc.moveDown(0.3);
    });

    doc.end();

  } catch (error) {
    console.error("PDF download error:", error);
    res.status(500).json({ message: "Failed to generate PDF" });
  }
};
