const Loan = require("../models/Loan");
const Customer = require("../models/customer");
const Transaction = require("../models/Transaction");
const Agent = require("../models/AgentModel");
const AgentCommission = require("../models/AgentCommission");

/* ===========================
   DASHBOARD REPORT
=========================== */
exports.getDashboardReport = async (req, res) => {
  try {
    const totalLoans = await Loan.countDocuments();
    const activeLoans = await Loan.countDocuments({ status: "active" });
    const overdueLoans = await Loan.countDocuments({ status: "overdue" });
    const defaultedLoans = await Loan.countDocuments({ isDefaulted: true });

    const loans = await Loan.find();

    const totalDisbursed = loans.reduce((s, l) => s + l.amount, 0);
    const totalOutstanding = loans.reduce((s, l) => s + l.balance, 0);
    const totalRepaid = loans.reduce((s, l) => s + l.repaidAmount, 0);

    res.json({
      success: true,
      summary: {
        totalLoans,
        activeLoans,
        overdueLoans,
        defaultedLoans,
        totalDisbursed,
        totalOutstanding,
        totalRepaid
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ===========================
   LOANS REPORT
=========================== */
exports.getLoansReport = async (req, res) => {
  try {
    const loans = await Loan.find()
      .populate("borrowerId", "fullName creditLevel")
      .populate("lenderId");

    const formattedLoans = loans.map((loan) => {
      /* =============================
         INSTALLMENT CALCULATION
      ============================= */

      let repaymentAmount = 0;

      if (loan.repaymentPlan === "daily") {
        repaymentAmount = loan.dailyRepayment || 0;
      } else if (loan.repaymentPlan === "weekly") {
        repaymentAmount = Math.round(
          (loan.totalRepayment || 0) / Math.ceil(loan.duration / 7)
        );
      } else if (loan.repaymentPlan === "monthly") {
        repaymentAmount = Math.round(
          (loan.totalRepayment || 0) / Math.ceil(loan.duration / 30)
        );
      }

      /* =============================
         REPAYMENT STATUS
      ============================= */

      let repaymentStatus = loan.status;

      if (loan.isDefaulted) {
        repaymentStatus = "defaulted";
      }

      return {
        loan_id: loan._id.toString(),
        borrower_name: loan.borrowerId?.fullName || "N/A",
        loan_amount: loan.amount || 0,
        total_repayment: loan.totalRepayment || 0,
        repayment_plan: loan.repaymentPlan || "daily",
        repayment_amount: repaymentAmount,
        outstanding_balance: loan.balance || 0,
        repayment_status: repaymentStatus,
        credit_score_band:
          loan.borrowerId?.creditLevel || "Unknown",
        issue_date: loan.issueDate
          ? loan.issueDate.toISOString().split("T")[0]
          : null,
        due_date: loan.dueDate
          ? loan.dueDate.toISOString().split("T")[0]
          : null,
      };
    });

    /* =============================
       SUMMARY
    ============================= */

    const summary = {
      count: loans.length,
      totalAmount: loans.reduce(
        (sum, loan) => sum + (loan.amount || 0),
        0
      ),
      totalInterest: loans.reduce(
        (sum, loan) => sum + (loan.interest || 0),
        0
      ),
      totalOutstanding: loans.reduce(
        (sum, loan) => sum + (loan.balance || 0),
        0
      ),
    };

    res.json({
      success: true,
      summary,
      data: formattedLoans,
    });

  } catch (err) {
    console.error("Loans report error:", err);
    res.status(500).json({ message: err.message });
  }
};



/* ===========================
   REPAYMENTS REPORT
=========================== */
exports.getRepaymentsReport = async (req, res) => {
  const repayments = await Transaction.find({ type: "repayment" });

  res.json({
    success: true,
    summary: {
      totalRepaid: repayments.reduce((s, r) => s + r.amount, 0),
      count: repayments.length
    },
    data: repayments
  });
};

/* ===========================
   PROFIT & INTEREST REPORT
=========================== */
exports.getProfitReport = async (req, res) => {
  const loans = await Loan.find();

  const interestExpected = loans.reduce((s, l) => s + l.interest, 0);
  const interestCollected = loans.reduce(
    (s, l) => s + Math.max(0, l.repaidAmount - l.amount),
    0
  );

  res.json({
    success: true,
    summary: {
      interestExpected,
      interestCollected,
      netProfit: interestCollected
    }
  });
};

/* ===========================
   BORROWERS PROFESSIONAL REPORT
=========================== */
exports.getBorrowersReport = async (req, res) => {
  try {
    const borrowers = await Customer.find().lean();

    const data = await Promise.all(
      borrowers.map(async (b, index) => {

        const loans = await Loan.find({ borrowerId: b._id }).lean();

        const activeLoans = loans.filter(
          l => l.status === "active"
        );

        const totalLoanAmount = loans.reduce(
          (sum, l) => sum + (l.amount || 0),
          0
        );

        const totalOutstanding = loans.reduce(
          (sum, l) => sum + (l.balance || 0),
          0
        );

        const latestLoan = loans.sort(
          (a, b2) => new Date(b2.createdAt) - new Date(a.createdAt)
        )[0];

        return {
          full_name: b.fullName || "N/A",

          // ✅ Custom Borrower ID Format
          borrower_id: `BRW-${1000 + index + 1}`,

          date_of_birth: b.dateOfBirth
            ? b.dateOfBirth.toISOString().split("T")[0]
            : null,

          phone: b.phone || null,
          email: b.email || null,
          address: b.physicalAddress || null,
          status: b.status || "Active",

          document_live_photo: b.livePhoto || null,
          document_front_id_photo: b.frontID || null,
          document_back_id_photo: b.backID || null,

          marital_status: b.maritalStatus || null,
          gender: b.gender || null,
          occupation: b.occupation || null,

          loan_credit_score: b.creditScore || 500,

          number_of_active_loans: activeLoans.length,
          total_loans: loans.length,
          total_loan_amount: totalLoanAmount,
          total_outstanding_amount: totalOutstanding,

          balance: latestLoan ? latestLoan.balance || 0 : 0,
          interest: latestLoan ? latestLoan.interest || 0 : 0,

          repayment_due_date: latestLoan?.dueDate
            ? latestLoan.dueDate.toISOString().split("T")[0]
            : null,

          payment_histories: latestLoan?.repayments?.length
            ? latestLoan.repayments.map(r => ({
                payment_date: r.date
                  ? new Date(r.date).toISOString().split("T")[0]
                  : null,
                amount: r.amount || 0,
                status: r.wasPaymentLate ? "Late" : "Paid"
              }))
            : []
        };
      })
    );

    res.json({
      success: true,
      count: data.length,
      borrowers: data
    });

  } catch (error) {
    console.error("Borrower report error:", error);
    res.status(500).json({ message: error.message });
  }
};



/* ===========================
   AGENTS REPORT
=========================== */
exports.getAgentsReport = async (req, res) => {
  try {
    const agents = await Agent.find().lean();

    const data = await Promise.all(
      agents.map(async (agent) => {

        // Loans handled by agent
        const loans = await Loan.find({
          requestedByAgentId: agent._id,
          loanRequestStatus: "approved"
        });

        const totalDisbursed = loans.reduce(
          (sum, loan) => sum + (loan.amount || 0),
          0
        );

        // Total customers handled
        const totalCustomers = await Customer.countDocuments({
          registeredBy: agent._id
        });

        // Commission earned
        const commissions = await AgentCommission.find({
          agentId: agent._id,
          status: "approved"
        });

        const commissionEarned = commissions.reduce(
          (sum, c) => sum + (c.amount || 0),
          0
        );

        return {
          _id: agent._id,
          lenderId: agent.lenderId,
          name: agent.fullName || agent.name,
          phone: agent.phone,
          status: agent.status,
          password:agent.password,
          region: agent.region || "N/A",
          totalEarnings: commissionEarned,
          walletBalance: agent.walletBalance || 0,
          commissionEarned,
          totalCustomers,
          role: "agent",
          loansHandled: loans.length,
          totalDisbursed
        };
      })
    );

    res.json({
      success: true,
      count: data.length,
      data
    });

  } catch (error) {
    console.error("Agents report error:", error);
    res.status(500).json({ message: error.message });
  }
};


/* ===========================
   AUDIT LOGS (BASIC)
=========================== */
exports.getAuditLogs = async (req, res) => {
  res.json({
    success: true,
    data: [] // extend later
  });
};


/* =====================================================
   LOAN & REPAYMENT REPORT (DATE RANGE)
   ❗ NEW API – DOES NOT CHANGE EXISTING CODE
===================================================== */
exports.getLoanRepaymentReport = async (req, res) => {
  try {
    const { borrowerId, loanId, fromDate, toDate } = req.query;

    // 🔹 Build filter (EMPTY = ALL BORROWERS)
    const loanFilter = {};

    if (borrowerId) {
      loanFilter.borrowerId = borrowerId;
    }

    if (loanId) {
      loanFilter._id = loanId;
    }

    if (fromDate || toDate) {
      loanFilter.createdAt = {};
      if (fromDate) loanFilter.createdAt.$gte = new Date(fromDate);
      if (toDate) loanFilter.createdAt.$lte = new Date(toDate);
    }

    // 🔹 Fetch loans for ALL borrowers
    const loans = await Loan.find(loanFilter)
      .populate("borrowerId", "fullName phone")
      .populate("lenderId", "fullName phone");

    let totalPrincipal = 0;
    let totalInterest = 0;
    let totalPaid = 0;
    let totalBalance = 0;

    const reportData = loans.map((loan) => {
      const paidAmount = Array.isArray(loan.repayments)
        ? loan.repayments.reduce((sum, r) => sum + (r.amount || 0), 0)
        : 0;

      totalPrincipal += loan.amount || 0;
      totalInterest += loan.interest || 0;
      totalPaid += paidAmount;
      totalBalance += loan.balance || 0;

      return {
        loanId: loan._id,
        borrowerId: loan.borrowerId?._id || null,
        borrowerName: loan.borrowerId?.fullName || "N/A",
        borrowerPhone: loan.borrowerId?.phone || "N/A",
        principalAmount: loan.amount,
        interestAmount: loan.interest,
        totalRepayment: loan.totalRepayment,
        paidAmount,
        outstandingBalance: loan.balance,
        status: loan.status,
        issueDate: loan.issueDate,
        dueDate: loan.dueDate
      };
    });

    return res.status(200).json({
      success: true,
      filtersApplied: {
        borrowerId: borrowerId || "ALL",
        loanId: loanId || "ALL",
        fromDate: fromDate || null,
        toDate: toDate || null
      },
      summary: {
        totalLoans: reportData.length,
        totalPrincipal,
        totalInterest,
        totalPaid,
        totalOutstandingBalance: totalBalance
      },
      data: reportData
    });

  } catch (error) {
    console.error("❌ Loan repayment report error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message
    });
  }
};


/* ===========================
   MARITAL STATUS REPORT
=========================== */
exports.getMaritalStatusReport = async (req, res) => {
  try {
    const data = await Customer.aggregate([
      {
        $group: {
          _id: "$maritalStatus",
          value: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          label: "$_id",
          value: 1
        }
      }
    ]);

    res.json({
      success: true,
      count: data.length,
      data
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


/* ===========================
   LOAN AMOUNT BY BUSINESS TYPE
=========================== */
exports.getBusinessTypeLoanReport = async (req, res) => {
  try {
    const data = await Loan.aggregate([
      // 🔹 Join customer collection
      {
        $lookup: {
          from: "customers",              // collection name (check exact name in MongoDB)
          localField: "borrowerId",       // field in Loan
          foreignField: "_id",            // field in Customer
          as: "borrower"
        }
      },

      // 🔹 Convert array to object
      { $unwind: "$borrower" },

      // 🔹 Group by occupation
      {
        $group: {
          _id: { $ifNull: ["$borrower.occupation", "Unknown"] },
          value: { $sum: "$amount" }
        }
      },

      // 🔹 Format output
      {
        $project: {
          _id: 0,
          type: "$_id",
          value: 1
        }
      }
    ]);

    res.json({
      success: true,
      data
    });

  } catch (err) {
    console.error("Business type report error:", err);
    res.status(500).json({ message: err.message });
  }
};


/* ===========================
   REPAYMENT PERCENTAGE BY REGION
=========================== */
exports.getRegionalRepaymentReport = async (req, res) => {
  try {
    const data = await Loan.aggregate([
      {
        $lookup: {
          from: "customers",
          localField: "borrowerId",
          foreignField: "_id",
          as: "borrower"
        }
      },
      { $unwind: "$borrower" },

      {
        $group: {
          _id: "$borrower.physicalAddress",
          totalLoan: { $sum: "$amount" },
          totalRepaid: { $sum: "$repaidAmount" }
        }
      },

      {
        $project: {
          _id: 0,
          region: "$_id",
          percent: {
            $cond: [
              { $eq: ["$totalLoan", 0] },
              0,
              {
                $multiply: [
                  { $divide: ["$totalRepaid", "$totalLoan"] },
                  100
                ]
              }
            ]
          }
        }
      }
    ]);

    res.json({ success: true, data });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ===========================
   PROFIT & INTEREST DETAILED REPORT
=========================== */
exports.getDetailedProfitReport = async (req, res) => {
  try {
    const loans = await Loan.find().populate("borrowerId", "fullName");

    let totalPrincipal = 0;
    let totalInterestExpected = 0;
    let totalInterestCollected = 0;
    let totalProfit = 0;

    const data = loans.map((loan) => {
      const principal = loan.amount || 0;
      const interest = loan.interest || 0;
      const totalRepayment = loan.totalRepayment || 0;
      const repaidAmount = loan.repaidAmount || 0;

      const interestCollected = Math.max(0, repaidAmount - principal);

      totalPrincipal += principal;
      totalInterestExpected += interest;
      totalInterestCollected += interestCollected;
      totalProfit += interestCollected;

      return {
        borrowerId: loan.borrowerId?._id || null,
        fullName: loan.borrowerId?.fullName || "N/A",
        loanAmount: principal,
        interestExpected: interest,
        totalRepayment,
        interestCollected,
        status: loan.status,
        dueDate: loan.dueDate
          ? loan.dueDate.toISOString().split("T")[0]
          : null
      };
    });

    res.json({
      success: true,
      summary: {
        totalLoans: loans.length,
        totalPrincipal,
        totalInterestExpected,
        totalInterestCollected,
        netProfit: totalProfit
      },
      data
    });

  } catch (error) {
    console.error("Profit report error:", error);
    res.status(500).json({ message: error.message });
  }
};

