const Stats = require('../models/Stats');
const Loan = require("../models/Loan");
const PDFDocument = require("pdfkit");
const Customer = require("../models/customer");


function getRange(type, fromDate, toDate) {
  const now = new Date();

  if (type === "7d") {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return { start: d, end: now };
  }

  if (type === "1m") {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return { start: d, end: now };
  }

  if (type === "3m") {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return { start: d, end: now };
  }

  if (fromDate && toDate) {
    const start = new Date(fromDate);
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  return null;
}

/* ================= CORE STATS CALCULATOR ================= */
function calculateStats(loans, start = null, end = null) {
  let issuedCount = 0;
  let totalLoanAmount = 0;
  let principalAmount = 0;
  let collectedAmount = 0;
  let interestEarned = 0;
  let outstandingLoanAmount = 0;
  let activeLoans = 0;
  let overdueLoans = 0;
  let paidLoans = 0;

  loans.forEach((loan) => {
    const issuedInRange =
      !start || !end || (loan.createdAt >= start && loan.createdAt <= end);

    // =========================
    // 1️⃣ LOANS ISSUED IN RANGE
    // =========================
    if (issuedInRange) {
      issuedCount++;
      totalLoanAmount += loan.totalRepayment || 0;
      principalAmount += loan.amount || 0;

      // ✅ outstanding = CURRENT balance of loans issued in range
      outstandingLoanAmount += loan.balance || 0;

      if (loan.balance > 0) {
        activeLoans++;
        if (loan.dueDate && new Date(loan.dueDate) < new Date()) {
          overdueLoans++;
        }
      } else {
        paidLoans++;
      }
    }

    // =========================
    // 2️⃣ COLLECTIONS (DATE BASED)
    // =========================
    if (Array.isArray(loan.repayments)) {
      loan.repayments.forEach((r) => {
        const paymentInRange =
          !start ||
          !end ||
          (r.date && r.date >= start && r.date <= end);

        if (paymentInRange) {
          collectedAmount += r.amount || 0;

          const principalPart = Math.min(r.amount || 0, loan.amount || 0);
          interestEarned += Math.max(0, (r.amount || 0) - principalPart);
        }
      });
    }
  });

  return {
    issuedCount,
    totalLoanAmount,
    principalAmount,
    collectedAmount,
    interestEarned,
    outstandingLoanAmount,
    activeLoans,
    overdueLoans,
    paidLoans
  };
}



/* ================= LOAN DETAIL MAPPER ================= */
function mapLoanDetail(loan) {
  return {
    borrower: loan.borrowerId?.fullName || "N/A",
    phone: loan.borrowerId?.phone || "N/A",
    principal: loan.amount,
    totalRepayment: loan.totalRepayment,
    collectedAmount: Array.isArray(loan.repayments)
      ? loan.repayments.reduce((s, r) => s + (r.amount || 0), 0)
      : 0,
    balance: loan.balance,
    issueDate: loan.createdAt,
    dueDate: loan.dueDate,
    status:
      loan.balance === 0
        ? "Paid"
        : loan.dueDate && new Date(loan.dueDate) < new Date()
        ? "Overdue"
        : "Active"
  };
}

/* ================= FILTER LOANS BY ISSUE DATE ================= */
function filterLoansByIssueDate(loans, start, end) {
  return loans.filter(
    (loan) => loan.createdAt >= start && loan.createdAt <= end
  );
}

function countCustomers(customers, start = null, end = null) {
  return customers.filter(c =>
    !start ||
    !end ||
    (c.createdAt >= start && c.createdAt <= end)
  ).length;
}


/* ================= GET STATS API ================= */
exports.getStats = async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    const loans = await Loan.find({ loanRequestStatus: "approved" })
      .populate("borrowerId", "fullName phone");

       const customers = await Customer.find({});

    const last7 = getRange("7d");
    const last1m = getRange("1m");
    const last3m = getRange("3m");
    const custom = getRange(null, fromDate, toDate);

    const last7Loans = filterLoansByIssueDate(loans, last7.start, last7.end);
    const last1mLoans = filterLoansByIssueDate(loans, last1m.start, last1m.end);
    const last3mLoans = filterLoansByIssueDate(loans, last3m.start, last3m.end);
    const customLoans = custom
      ? filterLoansByIssueDate(loans, custom.start, custom.end)
      : [];

    res.status(200).json({
      overall: {
        stats: calculateStats(loans),
        customersAdded: customers.length,
        loanDetails: loans.map(mapLoanDetail)
      },

      last7Days: {
        stats: calculateStats(loans, last7.start, last7.end),
        customersAdded: countCustomers(customers, last7.start, last7.end),
        loanDetails: last7Loans.map(mapLoanDetail)
      },

      last1Month: {
        stats: calculateStats(loans, last1m.start, last1m.end),
        customersAdded: countCustomers(customers, last1m.start, last1m.end),
        loanDetails: last1mLoans.map(mapLoanDetail)
      },

      last3Months: {
        stats: calculateStats(loans, last3m.start, last3m.end),
          customersAdded: countCustomers(customers, last3m.start, last3m.end),
        loanDetails: last3mLoans.map(mapLoanDetail)
      },

      customRange: custom
        ? {
            stats: calculateStats(loans, custom.start, custom.end),
            customersAdded: countCustomers(customers, custom.start, custom.end),
            loanDetails: customLoans.map(mapLoanDetail)
          }
        : null
    });

  } catch (error) {
    console.error("Stats error:", error);
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
