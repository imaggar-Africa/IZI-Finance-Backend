const mongoose = require("mongoose");
const Stats = require('../models/Stats');
const Loan = require("../models/Loan");
const PDFDocument = require("pdfkit");
const Customer = require("../models/customer");
const AgentModel = require("../models/AgentModel");
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

    if (req.user) {
      if (req.user.role === "lender") {
        match.lenderId = new mongoose.Types.ObjectId(req.user._id);
      } else if (req.user.role === "agent") {
        match.lenderId = new mongoose.Types.ObjectId(req.user.lenderId);
      }
    }

    // 🔹 Geography filters
    if (agentId) match.requestedByAgentId = new mongoose.Types.ObjectId(agentId);
    if (groupId) match.groupId = new mongoose.Types.ObjectId(groupId);

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

    if (req.user) {
      if (req.user.role === "lender") {
        match.lenderId = new mongoose.Types.ObjectId(req.user._id);
      } else if (req.user.role === "agent") {
        match.lenderId = new mongoose.Types.ObjectId(req.user.lenderId);
      }
    }

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
  const effectiveEnd = end || new Date();
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
    // ✅ Only approved loans
    if (loan.loanRequestStatus !== "approved") return;

    // ✅ Only these statuses
    if (!["active", "fully paid", "overdue"].includes(loan.status))
      return;

    const issuedDate = new Date(loan.issueDate || loan.createdAt);
    const issuedInRange =
      !start ||
      (start instanceof Date && isNaN(start.getTime()) ? true : (issuedDate >= start && issuedDate <= effectiveEnd));

    if (issuedInRange) {
      issuedCount++;

      const principal = Number(loan.amount) || 0;
      const totalRepay = Number(loan.totalRepayment) || (principal + (Number(loan.interest) || 0));
      const balance = Number(loan.balance) || 0;
      const interest = totalRepay - principal;

      totalLoanAmount += totalRepay;
      principalAmount += principal;
      outstandingLoanAmount += balance;
      interestEarned += interest > 0 ? interest : 0;

      // ===== STATUS COUNTS =====
      if (loan.status === "fully paid" || balance === 0) {
        paidLoans++;
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
          (r.date && r.date >= start && r.date <= effectiveEnd);

        if (paymentInRange) {
          collectedAmount += Number(r.amount) || 0;
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
    principal: Number(loan.amount) || 0,
    totalRepayment: Number(loan.totalRepayment) || ((Number(loan.amount) || 0) + (Number(loan.interest) || 0)),
    collectedAmount: Array.isArray(loan.repayments)
      ? loan.repayments.reduce((s, r) => s + (Number(r.amount) || 0), 0)
      : 0,
    balance: Number(loan.balance) || 0,
    issueDate: loan.issueDate || loan.createdAt,
    dueDate: loan.dueDate,
    status:
      Number(loan.balance) === 0
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
  const effectiveEnd = end || new Date();
  return customers.filter(c => {
    if (!c.createdAt) return false;
    const date = new Date(c.createdAt);
    return (!start || date >= start) && date <= effectiveEnd;
  }).length;
}


/* ================= GET STATS API ================= */
exports.getStats = async (req, res) => {
  try {
    const lenderId = req.user.role === "agent" ? req.user.lenderId : req.user._id;

    // Helper to get range start
    const getRangeStart = (type) => {
      const d = new Date();
      if (type === "24h") d.setHours(d.getHours() - 24);
      else if (type === "7d") d.setDate(d.getDate() - 7);
      else if (type === "1m") d.setMonth(d.getMonth() - 1);
      else if (type === "overall") return null;
      return d;
    };

    // We fetch ALL approved loans for this lender once
    const allLoans = await Loan.find({
      lenderId,
      loanRequestStatus: "approved",
      status: { $in: ["active", "fully paid", "overdue"] },
      isDeleted: { $ne: true },
      isWrittenOff: { $ne: true },
    }).populate("borrowerId", "fullName phone");

    const customerQuery = { isDeleted: { $ne: true } };
    if (req.user.role === "lender") {
      const agents = await AgentModel.find({ lenderId }).select("_id");
      const agentIds = agents.map(a => a._id);
      customerQuery.$or = [
        { registeredBy: lenderId, registeredByModel: "User" },
        { registeredBy: { $in: agentIds }, registeredByModel: "Agent" }
      ];
    } else if (req.user.role === "agent") {
      customerQuery.$or = [
        { registeredBy: req.user._id, registeredByModel: "Agent" },
        { agentId: req.user._id }
      ];
    }

    const allCustomers = await Customer.find(customerQuery);

    const buildSegment = (start) => {
      const segmentStats = calculateStats(allLoans, start);
      
      const activeInPeriod = allLoans.filter((l) => {
        if (!start) return true;
        const issuedDate = new Date(l.issueDate || l.createdAt);
        const issuedInRange = issuedDate >= start;
        const repaidInRange = Array.isArray(l.repayments) && l.repayments.some(r => r.date && new Date(r.date) >= start);
        return issuedInRange || repaidInRange;
      });

      const customerCount = countCustomers(allCustomers, start);

      return {
        stats: {
          issuedCount: segmentStats.issuedCount || 0,
          totalLoans: segmentStats.issuedCount || 0,
          totalLoanAmount: segmentStats.totalLoanAmount || 0,
          principalAmount: segmentStats.principalAmount || 0,
          collectedAmount: segmentStats.collectedAmount || 0,
          interestEarned: segmentStats.interestEarned || 0,
          outstandingLoanAmount: segmentStats.outstandingLoanAmount || 0,
          outstandingAmount: segmentStats.outstandingLoanAmount || 0,
          outstanding: segmentStats.outstandingLoanAmount || 0,
          activeLoans: segmentStats.activeLoans || 0,
          overdueLoans: segmentStats.overdueLoans || 0,
          paidLoans: segmentStats.paidLoans || 0,
          customersAdded: customerCount,
          totalCustomers: customerCount
        },
        customersAdded: customerCount,
        loanDetails: activeInPeriod.map(mapLoanDetail)
      };
    };

    // Format matches DashboardScreen and StatsScreen expectations:
    res.status(200).json({
      last24Hours: buildSegment(getRangeStart("24h")),
      last7Days: buildSegment(getRangeStart("7d")),
      last1Month: buildSegment(getRangeStart("1m")),
      overall: buildSegment(getRangeStart("overall"))
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
    const lenderId = req.user.role === "agent" ? req.user.lenderId : req.user._id;

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
    const lenderId = req.user.role === "agent" ? req.user.lenderId : req.user._id;

    /* ================= FETCH DATA ================= */

    const loans = await Loan.find({
      loanRequestStatus: "approved",
      lenderId: lenderId,
      status: { $in: ["active", "fully paid", "overdue"] },
      isDeleted: { $ne: true },
      isWrittenOff: { $ne: true }
    }).populate("borrowerId", "fullName phone");

    const customerQuery = { isDeleted: { $ne: true } };
    if (req.user.role === "lender") {
      const agents = await AgentModel.find({ lenderId }).select("_id");
      const agentIds = agents.map(a => a._id);
      customerQuery.$or = [
        { registeredBy: lenderId, registeredByModel: "User" },
        { registeredBy: { $in: agentIds }, registeredByModel: "Agent" }
      ];
    } else if (req.user.role === "agent") {
      customerQuery.$or = [
        { registeredBy: req.user._id, registeredByModel: "Agent" },
        { agentId: req.user._id }
      ];
    }
    const customers = await Customer.find(customerQuery);

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

exports.getFullyPaidLoansPDF = async (req, res) => {
  try {
    const lenderId = req.user.role === "agent" ? req.user.lenderId : req.user._id;
    const { fromDate, toDate } = req.query;

    const filter = {
      lenderId,
      status: "fully paid",
      loanRequestStatus: "approved",
      isDeleted: { $ne: true }
    };

    if (fromDate || toDate) {
      filter.issueDate = {};
      if (fromDate) filter.issueDate.$gte = new Date(fromDate);
      if (toDate) filter.issueDate.$lte = new Date(toDate);
    }

    const loans = await Loan.find(filter).populate("borrowerId", "fullName phone");

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 30
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="fully-paid-loans-report.pdf"'
    );

    doc.pipe(res);

    // 🏷 Logo
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, (doc.page.width - 90) / 2, 20, { width: 90 });
    }

    doc.y = 100;
    doc.fontSize(20).font("Helvetica-Bold").text("Fully Paid Loans Report", { align: "center" });
    doc.fontSize(10).font("Helvetica").text(`Generated on: ${new Date().toDateString()}`, { align: "center" });

    if (fromDate || toDate) {
      doc.text(`Period: ${fromDate || "Start"} to ${toDate || "Present"}`, { align: "center" });
    }

    doc.moveDown(1);

    // 📊 Table Setup
    const colSize = {
      sn: 30,
      borrower: 150,
      phone: 100,
      principal: 80,
      interest: 80,
      total: 80,
      issued: 80,
      paid: 80
    };

    const colPos = {
      sn: 30,
      borrower: 60,
      phone: 210,
      principal: 310,
      interest: 390,
      total: 470,
      issued: 550,
      paid: 630
    };

    let y = doc.y + 10;
    const rowHeight = 25;

    // Header Background
    doc.fillColor("#f0f0f0").rect(30, y - 5, doc.page.width - 60, rowHeight).fill();
    doc.fillColor("#000000").font("Helvetica-Bold").fontSize(9);

    doc.text("#", colPos.sn, y);
    doc.text("Borrower Name", colPos.borrower, y);
    doc.text("Phone", colPos.phone, y);
    doc.text("Principal", colPos.principal, y);
    doc.text("Interest", colPos.interest, y);
    doc.text("Total Repayment", colPos.total, y);
    doc.text("Issue Date", colPos.issued, y);
    doc.text("Paid Date", colPos.paid, y);

    y += rowHeight;
    doc.font("Helvetica").fontSize(8);

    // Rows
    loans.forEach((loan, index) => {
      if (y > doc.page.height - 60) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 30 });
        y = 40;
        doc.fillColor("#f0f0f0").rect(30, y - 5, doc.page.width - 60, rowHeight).fill();
        doc.fillColor("#000000").font("Helvetica-Bold");
        doc.text("#", colPos.sn, y);
        doc.text("Borrower Name", colPos.borrower, y);
        doc.text("Phone", colPos.phone, y);
        doc.text("Principal", colPos.principal, y);
        doc.text("Interest", colPos.interest, y);
        doc.text("Total Repayment", colPos.total, y);
        doc.text("Issue Date", colPos.issued, y);
        doc.text("Paid Date", colPos.paid, y);
        y += rowHeight;
        doc.font("Helvetica");
      }

      const paidDate = loan.repayments && loan.repayments.length > 0
        ? new Date(Math.max(...loan.repayments.map(r => new Date(r.date))))
        : loan.updatedAt;

      doc.text(index + 1, colPos.sn, y);
      doc.text(loan.borrowerId?.fullName || "N/A", colPos.borrower, y, { width: 140, ellipsis: true });
      doc.text(loan.borrowerId?.phone || "N/A", colPos.phone, y);
      doc.text(`KES ${loan.amount.toLocaleString()}`, colPos.principal, y);
      doc.text(`KES ${loan.interest.toLocaleString()}`, colPos.interest, y);
      doc.text(`KES ${loan.repaidAmount.toLocaleString()}`, colPos.total, y);
      doc.text(new Date(loan.issueDate).toLocaleDateString(), colPos.issued, y);
      doc.text(new Date(paidDate).toLocaleDateString(), colPos.paid, y);

      // Border line
      doc.moveTo(30, y + rowHeight - 8).lineTo(doc.page.width - 30, y + rowHeight - 8).lineWidth(0.5).strokeColor("#cccccc").stroke();
      doc.strokeColor("#000000");

      y += rowHeight;
    });

    if (loans.length === 0) {
      doc.text("No fully paid loans found for the selected period.", 30, y + 20, { align: "center" });
    }

    doc.end();

  } catch (error) {
    console.error("PDF fully paid report error:", error);
    res.status(500).json({ success: false, message: "Failed to generate report" });
  }
};
