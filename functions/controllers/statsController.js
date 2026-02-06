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
    const { fromDate, toDate } = req.query;
    const now = new Date();

    /* ================= DATE FILTER ================= */
    const loanFilter = { loanRequestStatus: "approved" };

    if (fromDate || toDate) {
      loanFilter.createdAt = {};
      if (fromDate) loanFilter.createdAt.$gte = new Date(fromDate);
      if (toDate) loanFilter.createdAt.$lte = new Date(toDate);
    }

    /* ================= FETCH LOANS ================= */
    const loans = await Loan.find(loanFilter)
      .populate("borrowerId", "fullName phone");

    /* ================= CALCULATIONS ================= */
    let totalPrincipal = 0;
    let totalLoanAmount = 0;
    let totalCollected = 0;
    let outstanding = 0;
    let activeLoans = 0;
    let paidLoans = 0;
    let overdueLoans = 0;

    loans.forEach((loan) => {
      totalPrincipal += loan.amount || 0;
      totalLoanAmount += loan.totalRepayment || 0;
      totalCollected += Array.isArray(loan.repayments)
        ? loan.repayments.reduce((s, r) => s + (r.amount || 0), 0)
        : 0;
      outstanding += loan.balance || 0;

      if (loan.balance > 0) {
        activeLoans++;
        if (new Date(loan.dueDate) < now) overdueLoans++;
      } else {
        paidLoans++;
      }
    });

    /* ================= CREATE PDF ================= */
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 30
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="loan-details-report.pdf"'
    );

    doc.pipe(res);

    /* ================= TITLE ================= */
    doc.fontSize(18).text("Loan Report", { align: "center" });
    doc.moveDown(0.5);

    if (fromDate || toDate) {
      doc.fontSize(10).text(
        `Period: ${
          fromDate ? new Date(fromDate).toDateString() : "Start"
        } → ${
          toDate ? new Date(toDate).toDateString() : "Today"
        }`,
        { align: "center" }
      );
    }

    doc.moveDown(1);

    /* ================= OVERALL SUMMARY ================= */
    doc.fontSize(14).text("Overall Summary", { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(10);
    doc.text(`Total Loans           : ${loans.length}`);
    doc.text(`Total Principal       : KES ${totalPrincipal}`);
    doc.text(`Total Loan Amount     : KES ${totalLoanAmount}`);
    doc.text(`Total Collected       : KES ${totalCollected}`);
    doc.text(`Outstanding Amount   : KES ${outstanding}`);
    doc.text(`Active Loans          : ${activeLoans}`);
    doc.text(`Paid Loans            : ${paidLoans}`);
    doc.text(`Overdue Loans         : ${overdueLoans}`);

    doc.moveDown(1.5);

    /* ================= TABLE ================= */
    const rowHeight = 18;
    let y = doc.y;

    const col = {
      sn: 30,
      borrower: 60,
      phone: 170,
      principal: 290,
      total: 350,
      collected: 410,
      balance: 480,
      issue: 550,
      due: 630,
      status: 710
    };

    doc.fontSize(8).font("Helvetica-Bold");

    drawRow(doc, y, col, [
      "#",
      "Borrower",
      "Phone",
      "Principal",
      "Total",
      "Collected",
      "Balance",
      "Issue Date",
      "Due Date",
      "Status"
    ]);

    y += rowHeight;
    doc.font("Helvetica");

    loans.forEach((loan, index) => {
      const collected = Array.isArray(loan.repayments)
        ? loan.repayments.reduce((s, r) => s + (r.amount || 0), 0)
        : 0;

      let status = "Paid";
      if (loan.balance > 0 && new Date(loan.dueDate) < now) status = "Overdue";
      else if (loan.balance > 0) status = "Active";

      drawRow(doc, y, col, [
        index + 1,
        loan.borrowerId?.fullName || "N/A",
        loan.borrowerId?.phone || "N/A",
        loan.amount,
        loan.totalRepayment,
        collected,
        loan.balance,
        new Date(loan.createdAt).toDateString(),
        new Date(loan.dueDate).toDateString(),
        status
      ]);

      y += rowHeight;

      if (y > doc.page.height - 40) {
        doc.addPage({ layout: "landscape", margin: 30 });
        y = 40;

        doc.fontSize(8).font("Helvetica-Bold");
        drawRow(doc, y, col, [
          "#",
          "Borrower",
          "Phone",
          "Principal",
          "Total",
          "Collected",
          "Balance",
          "Issue Date",
          "Due Date",
          "Status"
        ]);
        y += rowHeight;
        doc.font("Helvetica");
      }
    });

    doc.end();

  } catch (error) {
    console.error("PDF download error:", error);
    res.status(500).json({ message: "Failed to generate PDF" });
  }
};

/* ================= HELPER ================= */
function drawRow(doc, y, col, row) {
  const height = 18;
  const cells = [
    [col.sn, 30],
    [col.borrower, 110],
    [col.phone, 120],
    [col.principal, 60],
    [col.total, 60],
    [col.collected, 70],
    [col.balance, 70],
    [col.issue, 80],
    [col.due, 80],
    [col.status, 60]
  ];

  cells.forEach(([x, w], i) => {
    doc.rect(x, y, w, height).stroke();
    doc.text(String(row[i]), x + 3, y + 4, {
      width: w - 6,
      ellipsis: true
    });
  });
}






