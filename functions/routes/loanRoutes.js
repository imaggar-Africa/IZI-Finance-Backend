const express = require("express");
const router = express.Router();

const loanController = require("../controllers/loanController");
const { protect, borrowerProtect } = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/rolemiddleware");

2
// Issue loan
router.post("/issue", protect, loanController.issueLoan);

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
  authorizeRoles("lender","agent"),
  loanController.getLoansByBorrower
);



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

// Get payment instructions (QR / Pay link)
router.get(
  "/pay/:loanId",
  protect,
  loanController.getPaymentInstructions
);



module.exports = router;
