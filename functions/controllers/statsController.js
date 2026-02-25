const Stats = require('../models/Stats');
const Loan = require("../models/Loan");
const PDFDocument = require("pdfkit");
const Customer = require("../models/customer");




const buildLoanFilter = (filters) => {
  const query = {
    loanRequestStatus: "approved"
  }

  // Loan type
  if (filters.loanType === "active") query.status = "active"
  if (filters.loanType === "restructured") query.isRestructured = true
  if (filters.loanType === "writtenOff") query.isWrittenOff = true

  // Date range (FIXED: issueDate)
  if (filters.from && filters.to) {
    query.issueDate = {
      $gte: new Date(filters.from),
      $lte: new Date(filters.to)
    }
  }

  // Agent
  if (filters.agentId) {
    query.requestedByAgentId = filters.agentId
  }

  // Borrower cycle (derived from loanCycle stored)
  if (filters.cycle === "first") query.loanCycle = 1
  if (filters.cycle === "repeat") query.loanCycle = { $gt: 1 }
  if (filters.cycle === "3plus") query.loanCycle = { $gte: 3 }

  // Risk score (creditScoreAfter in loan)
  if (filters.risk === "low") query.creditScoreAfter = { $gte: 750 }
  if (filters.risk === "medium")
    query.creditScoreAfter = { $gte: 600, $lt: 750 }
  if (filters.risk === "high") query.creditScoreAfter = { $lt: 600 }

  return query
}



exports.getLoanSummary = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      status = "all",
      agentId,
      groupId,
      borrowerCycle,
      riskCategory
    } = req.query;

    // 🔹 BASE FILTER – DISBURSED LOANS ONLY
    const match = {
      loanRequestStatus: "approved",
      status: { $in: ["active", "fully paid"] }
    };

    // 🔹 Date filter
if (startDate && endDate) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  match.issueDate = {
    $gte: start,
    $lte: end
  };
}

    // 🔹 Status override
    if (status === "active") {
      match.status = "active";
      match.isDefaulted = false;
    }

    if (status === "closed") {
      match.status = "fully paid";
      match.balance = 0;
    }

    if (status === "written-off") {
      match.isDefaulted = true;
    }

    // 🔹 Geography filters
    if (agentId) match.requestedByAgentId = agentId;
    if (groupId) match.groupId = groupId;

    // 🔹 Borrower cycle
    if (borrowerCycle === "first") match.loanCycle = 1;
    if (borrowerCycle === "repeat") match.loanCycle = { $gte: 2 };
    if (borrowerCycle === "3+") match.loanCycle = { $gte: 3 };

    // 🔹 Risk category
    if (riskCategory === "low") match.creditScoreAfter = { $gte: 750 };
    if (riskCategory === "medium")
      match.creditScoreAfter = { $gte: 600, $lt: 750 };
    if (riskCategory === "high") match.creditScoreAfter = { $lt: 600 };

    // 🔹 AGGREGATION
    const summary = await Loan.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,

          totalLoans: { $sum: 1 },

          totalDisbursedAmount: { $sum: "$amount" },

          totalOutstandingAmount: {
            $sum: {
              $cond: [
                { $eq: ["$status", "active"] },
                "$balance",
                0
              ]
            }
          },

          activeLoans: {
            $sum: {
              $cond: [{ $eq: ["$status", "active"] }, 1, 0]
            }
          },

          closedLoans: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$status", "fully paid"] },
                    { $eq: ["$balance", 0] }
                  ]
                },
                1,
                0
              ]
            }
          },

          writtenOffLoans: {
            $sum: {
              $cond: [{ $eq: ["$isDefaulted", true] }, 1, 0]
            }
          },

          averageLoanSize: { $avg: "$amount" }
        }
      }
    ]);

    const data = summary[0] || {};

    return res.json({
      dateRange: { startDate, endDate },

      totalLoans: data.totalLoans || 0,
      totalDisbursedAmount: data.totalDisbursedAmount || 0,
      totalOutstandingAmount: data.totalOutstandingAmount || 0,
      averageLoanSize: Number((data.averageLoanSize || 0).toFixed(2)), 

      activeLoans: data.activeLoans || 0,
      closedLoans: data.closedLoans || 0,
      writtenOffLoans: data.writtenOffLoans || 0
    });
  } catch (error) {
    console.error("Loan Summary Error:", error);
    res.status(500).json({ message: "Failed to fetch loan summary" });
  }
};






exports.getPAR = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      parType,
      agentId,
      groupId,
      borrowerCycle,
      riskCategory
    } = req.query;

    if (!parType) {
      return res.status(400).json({ message: "parType is required" });
    }

    const parDaysMap = { PAR1: 1, PAR7: 7, PAR30: 30 };
    const parDays = parDaysMap[parType];
    if (!parDays) {
      return res.status(400).json({ message: "Invalid PAR type" });
    }

    const today = new Date();

    // 🔹 BASE MATCH (Loan-level)
    const match = {
      status: "active",
      isDefaulted: false
    };

    if (startDate && endDate) {
      match.issueDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (agentId) {
      match.requestedByAgentId = new mongoose.Types.ObjectId(agentId);
    }

    if (borrowerCycle === "first") match.loanCycle = 1;
    if (borrowerCycle === "repeat") match.loanCycle = { $gte: 2 };
    if (borrowerCycle === "3+") match.loanCycle = { $gte: 3 };

    if (riskCategory === "low") match.creditScoreAfter = { $gte: 750 };
    if (riskCategory === "medium")
      match.creditScoreAfter = { $gte: 600, $lt: 750 };
    if (riskCategory === "high") match.creditScoreAfter = { $lt: 600 };

    const pipeline = [
      { $match: match },

      // 🔹 JOIN GroupMember
      {
        $lookup: {
          from: "groupmembers",
          localField: "borrowerId",
          foreignField: "borrowerId",
          as: "groupMember"
        }
      },

      // 🔹 Unwind (borrower may not be in group)
      { $unwind: { path: "$groupMember", preserveNullAndEmptyArrays: true } }
    ];

    // 🔹 APPLY GROUP FILTER (CORRECT PLACE)
    if (groupId) {
      pipeline.push({
        $match: {
          "groupMember.groupId": new mongoose.Types.ObjectId(groupId)
        }
      });
    }

    pipeline.push(
      {
        $addFields: {
          overdueDays: {
            $dateDiff: {
              startDate: "$dueDate",
              endDate: today,
              unit: "day"
            }
          }
        }
      },
      {
        $facet: {
          total: [
            {
              $group: {
                _id: null,
                totalOutstanding: { $sum: "$balance" },
                totalLoans: { $sum: 1 }
              }
            }
          ],
          overdue: [
            { $match: { overdueDays: { $gte: parDays } } },
            {
              $group: {
                _id: null,
                overdueOutstanding: { $sum: "$balance" },
                overdueLoans: { $sum: 1 },
                avgDaysLate: { $avg: "$overdueDays" }
              }
            }
          ]
        }
      }
    );

    const result = await Loan.aggregate(pipeline);

    const total = result[0]?.total[0] || {};
    const overdue = result[0]?.overdue[0] || {};

    const totalOutstanding = total.totalOutstanding || 0;
    const overdueOutstanding = overdue.overdueOutstanding || 0;

    const parPercentage =
      totalOutstanding > 0
        ? Number(((overdueOutstanding / totalOutstanding) * 100).toFixed(2))
        : 0;

    return res.json({
      parType,
      dateRange: { startDate, endDate },
      totalOutstanding,
      overdueOutstanding,
      parPercentage,
      totalLoans: total.totalLoans || 0,
      overdueLoans: overdue.overdueLoans || 0,
      averageDaysLate: Math.round(overdue.avgDaysLate || 0)
    });
  } catch (err) {
    console.error("PAR API Error:", err);
    res.status(500).json({ message: "Failed to calculate PAR" });
  }
};








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

    const lenderId = req.user._id;

const loans = await Loan.find({
  loanRequestStatus: "approved",
  lenderId: lenderId
}).populate("borrowerId", "fullName phone");


       const customers = await Customer.find({ registeredBy: lenderId});

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
    const lenderId = req.user._id;

const loanFilter = {
  loanRequestStatus: "approved",
  lenderId: lenderId
};


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


exports.downloadFullOverallReportPDF = async (req, res) => {
  try {
    const now = new Date();

    /* ================= FETCH DATA ================= */
   const lenderId = req.user._id;

const loans = await Loan.find({
  loanRequestStatus: "approved",
  lenderId: lenderId
}).populate("borrowerId", "fullName phone");


    const customers = await Customer.find({registeredBy: lenderId});

    /* ================= CALCULATIONS ================= */
    let totalPrincipal = 0;
    let totalRepayment = 0;
    let totalCollected = 0;
    let totalOutstanding = 0;

    loans.forEach((loan) => {
      totalPrincipal += loan.amount || 0;
      totalRepayment += loan.totalRepayment || 0;
      totalOutstanding += loan.balance || 0;

      if (Array.isArray(loan.repayments)) {
        totalCollected += loan.repayments.reduce(
          (s, r) => s + (r.amount || 0),
          0
        );
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
      'attachment; filename="overall-system-report.pdf"'
    );

    doc.pipe(res);

    /* =======================================================
       1️⃣ TITLE
    ======================================================= */
    doc.fontSize(18).text("Overall System Report", { align: "center" });
    doc.moveDown();

    doc.fontSize(10).text(`Generated On: ${now.toDateString()}`, {
      align: "center"
    });

    doc.moveDown(2);

    /* =======================================================
       2️⃣ OVERALL SUMMARY
    ======================================================= */
    doc.fontSize(14).text("Overall Financial Summary", { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(10);
    doc.text(`Total Customers       : ${customers.length}`);
    doc.text(`Total Loans Issued    : ${loans.length}`);
    doc.text(`Total Principal       : KES ${totalPrincipal}`);
    doc.text(`Total Repayment       : KES ${totalRepayment}`);
    doc.text(`Total Collected       : KES ${totalCollected}`);
    doc.text(`Total Outstanding     : KES ${totalOutstanding}`);

    doc.addPage({ layout: "landscape", margin: 30 });

    /* =======================================================
       3️⃣ CUSTOMER DETAILS TABLE
    ======================================================= */
    doc.fontSize(14).text("Customer Details", { underline: true });
    doc.moveDown();

    customers.forEach((customer, index) => {
      doc.fontSize(9).text(
        `${index + 1}. ${customer.fullName} | ${customer.phone} | ${customer.email} | ${customer.physicalAddress}`
      );
    });

    doc.addPage({ layout: "landscape", margin: 30 });

    /* =======================================================
       4️⃣ LOAN DETAILS TABLE
    ======================================================= */
    doc.fontSize(14).text("Loan Details", { underline: true });
    doc.moveDown();

    loans.forEach((loan, index) => {
      const collected = Array.isArray(loan.repayments)
        ? loan.repayments.reduce((s, r) => s + (r.amount || 0), 0)
        : 0;

      let status = "Paid";
      if (loan.balance > 0 && new Date(loan.dueDate) < now)
        status = "Overdue";
      else if (loan.balance > 0)
        status = "Active";

      doc.fontSize(9).text(
        `${index + 1}. ${loan.borrowerId?.fullName || "N/A"} | Principal: ${
          loan.amount
        } | Total: ${loan.totalRepayment} | Collected: ${collected} | Balance: ${
          loan.balance
        } | Status: ${status}`
      );
    });

    doc.addPage({ layout: "landscape", margin: 30 });

    /* =======================================================
       5️⃣ REPAYMENT DETAILS
    ======================================================= */
    doc.fontSize(14).text("Repayment Details", { underline: true });
    doc.moveDown();

    loans.forEach((loan) => {
      if (Array.isArray(loan.repayments)) {
        loan.repayments.forEach((repayment) => {
          doc.fontSize(9).text(
            `${loan.borrowerId?.fullName || "N/A"} | ${
              repayment.date
            } | Amount: ${repayment.amount}`
          );
        });
      }
    });

    doc.end();

  } catch (error) {
    console.error("Full report PDF error:", error);
    res.status(500).json({ message: "Failed to generate full report" });
  }
};




