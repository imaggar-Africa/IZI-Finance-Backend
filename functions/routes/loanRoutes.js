const express = require("express");
const router = express.Router();

const loanController = require("../controllers/loanController");
const { protect, borrowerProtect } = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/rolemiddleware");
const loanRestriction = require("../middleware/loanRestriction");

2
// Issue loan
router.post("/issue", protect, loanRestriction, loanController.issueLoan);

// Outstanding loans (borrower)
router.post(
  "/outstanding/loan-details",
  borrowerProtect,
  loanController.getActiveLoansByPhone
);

// Repayment
router.post("/repay", borrowerProtect, loanController.trackRepayment);

// Fully paid
router.get("/fully-paid", protect, loanController.getFullyPaidLoans);
// router.get(
//   "/customers-with-fully-paid/loans",
//   loanController.getAllCustomersWithLoansFullyPaid
// );



router.get(
  "/borrower/:borrowerId/fully-paid/pdf",
  loanController.generateFullyPaidLoansPDF
);

router.get(
  "/borrower/:borrowerId/fully-paid",
  loanController.getFullyPaidLoansByCustomer
);

router.get(
  "/borrowers/active-overdue",
  loanController.getBorrowersWithLoans
);

router.get(
  "/outstanding/:borrowerId",
  protect,
  authorizeRoles("lender", "agent"),
  loanController.getLoansByBorrower
);

router.get("/outstanding/all",
  protect,
  authorizeRoles("lender"),
  loanController.getOutstandingLoans
)



// Agent → request loan
router.post(
  "/request-loan",
  protect,
  authorizeRoles("agent"),
  loanController.requestLoan
);

// Lender → review
router.get(
  "/loan-requests",
  protect,
  authorizeRoles("lender"),
  loanController.getAllLoanRequests
);

router.post(
  "/review-loan",
  protect,
  loanRestriction,
  authorizeRoles("lender"),
  loanController.reviewLoanRequest
);

// Agent → active loans
router.get(
  "/active-loans",
  protect,
  authorizeRoles("agent"),
  loanController.getActiveLoansByAgent
);

// Agent → loan history
router.get(
  "/history",
  protect,
  authorizeRoles("agent"),
  loanController.getAgentLoanHistory
);

// --- NEW Borrower-Agent-Lender Flow ---

// Borrower → request loan from agent
router.post(
  "/borrower/request",
  borrowerProtect,
  loanController.borrowerRequestLoan
);

// Agent → view borrower requests
router.get(
  "/agent/borrower-requests",
  protect,
  authorizeRoles("agent"),
  loanController.getBorrowerLoanRequests
);

// Agent → approve/reject borrower request
router.post(
  "/agent/borrower-action",
  protect,
  authorizeRoles("agent"),
  loanController.agentActionOnBorrowerRequest
);

// Get payment instructions (QR / Pay link)
router.get(
  "/pay/:loanId",
  protect,
  loanController.getPaymentInstructions
);

// Download loan receipt PDF
router.get(
  "/:loanId/receipt/pdf",
  protect,
  loanController.generateLoanReceiptPDF
);

// routes/reportRoutes.js
router.get(
  "/customer-statement/:borrowerId",
  protect,
  authorizeRoles("lender"),
  loanController.getCustomerStatement
);

router.get(
  "/eligibility/:borrowerId",
  protect,
  loanController.getEligibility
);

router.post(
  "/send-statement-sms",

  protect,
  authorizeRoles("lender"),
  loanController.sendStatementSMS
);


module.exports = router;
