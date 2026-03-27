const Stats = require('../models/Stats');
const Loan = require("../models/Loan");
const PDFDocument = require("pdfkit");
const Customer = require("../models/customer");
const path = require("path");
const fs = require("fs");
const logoPath = path.join(__dirname, "../assets/izi-logo.png");



function maskPhone(phone) {

  if (!phone) return "N/A";

  const str = phone.toString();

  if (str.length <= 6) return str;

  const start = str.slice(0, 6);
  const end = str.slice(-2);

  return start + "****" + end;
}

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

  const today = new Date();

  loans.forEach((loan) => {

    // ✅ Only approved loans
    if (loan.loanRequestStatus !== "approved") return;

    // ✅ Only these statuses
    if (!["active", "fully paid", "overdue"].includes(loan.status))
      return;

    const issuedInRange =
      !start ||
      !end ||
      (loan.issueDate >= start && loan.issueDate <= end);

    if (issuedInRange) {
      issuedCount++;

      totalLoanAmount += loan.totalRepayment || 0;
      principalAmount += loan.amount || 0;
      outstandingLoanAmount += loan.balance || 0;

      // ===== STATUS COUNTS =====
      if (loan.status === "fully paid" || loan.balance === 0) {
        paidLoans++;
        interestEarned +=
          (loan.totalRepayment || 0) - (loan.amount || 0);
      } else if (loan.status === "overdue") {
        overdueLoans++;
      } else if (loan.status === "active") {
        activeLoans++;
      }
    }

    // ===== COLLECTIONS =====
    if (Array.isArray(loan.repayments)) {
      loan.repayments.forEach((r) => {
        const paymentInRange =
          !start ||
          !end ||
          (r.date && r.date >= start && r.date <= end);

        if (paymentInRange) {
          collectedAmount += r.amount || 0;
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
    const { from, fromDate, toDate } = req.query;
    const lenderId = req.user._id;

    /* =========================
       DATE RANGE LOGIC
    ========================= */

    let startDate = new Date();
    let endDate = new Date();

    switch (from) {
      case "7d":
        startDate.setDate(endDate.getDate() - 7);
        break;

      case "1w":
        startDate.setDate(endDate.getDate() - 7);
        break;

      case "1m":
        startDate.setMonth(endDate.getMonth() - 1);
        break;

      case "custom":
        startDate = new Date(fromDate);
        endDate = new Date(toDate);
        break;

      default:
        // Default → last 24 hours
        startDate.setHours(endDate.getHours() - 24);
    }

    /* =========================
       FETCH LOANS
    ========================= */

    const loans = await Loan.find({
      loanRequestStatus: "approved",
      lenderId: lenderId,
      status: { $in: ["active", "fully paid", "overdue"] },
      isDeleted: { $ne: true },
      isWrittenOff: { $ne: true },
      createdAt: { $gte: startDate, $lte: endDate }
    }).populate("borrowerId", "fullName phone");

    const customers = await Customer.find({
      registeredBy: lenderId,
      createdAt: { $gte: startDate, $lte: endDate }
    });

    res.status(200).json({
      range: {
        from: startDate,
        to: endDate
      },
      stats: calculateStats(loans),
      customersAdded: customers.length,
      loanDetails: loans.map(mapLoanDetail)
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
    const lenderId = req.user._id;

    const loanFilter = {
      loanRequestStatus: "approved",
      lenderId: lenderId,
      status: { $in: ["active", "fully paid", "overdue"] },
      isDeleted: { $ne: true },
      isWrittenOff: { $ne: true }
    };

    if (fromDate || toDate) {
      loanFilter.createdAt = {};
      if (fromDate) loanFilter.createdAt.$gte = new Date(fromDate);
      if (toDate) loanFilter.createdAt.$lte = new Date(toDate);
    }

    const loans = await Loan.find(loanFilter)
      .populate("borrowerId", "fullName phone");

    const loanDetails = loans.map(mapLoanDetail);

    let totalPrincipal = 0;
    let totalLoanAmount = 0;
    let totalCollected = 0;
    let outstanding = 0;
    let activeLoans = 0;
    let paidLoans = 0;
    let overdueLoans = 0;

    loanDetails.forEach((loan) => {

      totalPrincipal += loan.principal || 0;
      totalLoanAmount += loan.totalRepayment || 0;
      totalCollected += loan.collectedAmount || 0;
      outstanding += loan.balance || 0;

      if (loan.status === "Paid") paidLoans++;
      else if (loan.status === "Overdue") overdueLoans++;
      else if (loan.status === "Active") activeLoans++;

    });

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

    /* LOGO (ONLY ONCE) */

    if (fs.existsSync(logoPath)) {

      const logoWidth = 90;

      doc.image(
        logoPath,
        (doc.page.width - logoWidth) / 2,
        20,
        { width: logoWidth }
      );

    }

    doc.y = 120;

    /* TITLE */

    doc.fontSize(18).text("Loan Report", { align: "center" });

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

    /* SUMMARY */

    doc.moveDown(0.5);

    doc.fontSize(14).text("Overall Summary", { underline: true });

    doc.fontSize(10);

    doc.text(`Total Loans           : ${loanDetails.length}`);
    doc.text(`Total Principal       : KES ${totalPrincipal}`);
    doc.text(`Total Loan Amount     : KES ${totalLoanAmount}`);
    doc.text(`Total Collected       : KES ${totalCollected}`);
    doc.text(`Outstanding Amount    : KES ${outstanding}`);
    doc.text(`Active Loans          : ${activeLoans}`);
    doc.text(`Paid Loans            : ${paidLoans}`);
    doc.text(`Overdue Loans         : ${overdueLoans}`);

    /* TABLE START (NO EXTRA SPACE) */

    const rowHeight = 18;
    let y = doc.y + 5;

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

    loanDetails.forEach((loan, index) => {

  // PAGE SPACE CHECK FIRST
  if (y + rowHeight > doc.page.height - 40) {

    doc.addPage({
      size: "A4",
      layout: "landscape",
      margin: 30
    });

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

  // NOW DRAW ROW
  drawRow(doc, y, col, [
    index + 1,
    loan.borrower,
     maskPhone(loan.phone),
    loan.principal,
    loan.totalRepayment,
    loan.collectedAmount,
    loan.balance,
    new Date(loan.issueDate).toDateString(),
    new Date(loan.dueDate).toDateString(),
    loan.status
  ]);

  y += rowHeight;

});

    doc.end();

  } catch (error) {

    console.error("PDF download error:", error);

    res.status(500).json({
      message: "Failed to generate PDF"
    });

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
    const lenderId = req.user._id;

    /* ================= FETCH DATA ================= */

    const loans = await Loan.find({
      loanRequestStatus: "approved",
      lenderId: lenderId,
      status: { $in: ["active", "fully paid", "overdue"] },
      isDeleted: { $ne: true },
      isWrittenOff: { $ne: true }
    }).populate("borrowerId", "fullName phone");

    const customers = await Customer.find({
      isDeleted: { $ne: true }
    });

    /* ================= CORRECT FINANCIAL LOGIC ================= */

    let totalPrincipal = 0;
    let totalLoanAmount = 0;
    let totalCollected = 0;
    let totalOutstanding = 0;

    let activeLoans = 0;
    let overdueLoans = 0;
    let paidLoans = 0;

    loans.forEach((loan) => {

      const principal = loan.amount || 0;
      const total = loan.totalRepayment || 0;
      const balance = loan.balance || 0;

      const collected = Array.isArray(loan.repayments)
        ? loan.repayments.reduce((s, r) => s + (r.amount || 0), 0)
        : 0;

      totalPrincipal += principal;
      totalLoanAmount += total;
      totalCollected += collected;
      totalOutstanding += balance;

      if (balance === 0) {

        paidLoans++;

      }
      else if (
        balance > 0 &&
        loan.dueDate &&
        new Date(loan.dueDate) < now
      ) {

        overdueLoans++;

      }
      else if (balance > 0) {

        activeLoans++;

      }

    });

    const loanDetails = loans.map(mapLoanDetail);

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

    /* ================= LOGO ================= */

    if (fs.existsSync(logoPath)) {

      const logoWidth = 90;

      doc.image(
        logoPath,
        (doc.page.width - logoWidth) / 2,
        20,
        { width: logoWidth }
      );

    }

    doc.y = 120;

    /* ================= TITLE ================= */

    doc.fontSize(18).text("Overall System Report", { align: "center" });

    doc.moveDown(0.5);

    doc.fontSize(10).text(
      `Generated On: ${now.toDateString()}`,
      { align: "center" }
    );

    doc.moveDown(1);

    /* ================= FINANCIAL SUMMARY ================= */

    doc.fontSize(14).text("Overall Financial Summary", { underline: true });

    doc.moveDown(0.5);

    doc.fontSize(10);

    doc.text(`Total Customers       : ${customers.length}`);
    doc.text(`Total Loans Issued    : ${loans.length}`);
    doc.text(`Total Principal       : KES ${totalPrincipal}`);
    doc.text(`Total Loan Amount     : KES ${totalLoanAmount}`);
    doc.text(`Total Collected       : KES ${totalCollected}`);
    doc.text(`Total Outstanding     : KES ${totalOutstanding}`);
    doc.text(`Active Loans          : ${activeLoans}`);
    doc.text(`Paid Loans            : ${paidLoans}`);
    doc.text(`Overdue Loans         : ${overdueLoans}`);

    /* ================= CUSTOMER DETAILS ================= */

    doc.addPage();

    doc.fontSize(14).text("Customer Details", { underline: true });

    doc.moveDown(0.5);

    customers.forEach((customer, index) => {

      doc.fontSize(9).text(
        `${index + 1}. ${customer.fullName} | ${maskPhone(customer.phone)} | ${customer.email || "N/A"} | ${customer.physicalAddress || "N/A"}`
      );

    });

    /* ================= LOAN DETAILS ================= */

    doc.addPage();

    doc.fontSize(14).text("Loan Details", { underline: true });

    doc.moveDown(0.5);

    loanDetails.forEach((loan, index) => {

      doc.fontSize(9).text(
        `${index + 1}. ${loan.borrower} | Phone: ${maskPhone(loan.phone)} | Principal: ${
          loan.principal
        } | Total: ${loan.totalRepayment} | Collected: ${
          loan.collectedAmount
        } | Balance: ${loan.balance} | Status: ${loan.status}`
      );

    });

    /* ================= REPAYMENT DETAILS ================= */

    doc.addPage();

    doc.fontSize(14).text("Repayment Details", { underline: true });

    doc.moveDown(0.5);

    loans.forEach((loan) => {

      if (Array.isArray(loan.repayments)) {

        loan.repayments.forEach((repayment) => {

          doc.fontSize(9).text(
            `${loan.borrowerId?.fullName || "N/A"} | ${new Date(
              repayment.date
            ).toDateString()} | Amount: ${repayment.amount}`
          );

        });

      }

    });

    doc.end();

  } catch (error) {

    console.error("Full report PDF error:", error);

    res.status(500).json({
      message: "Failed to generate full report"
    });

  }
};




