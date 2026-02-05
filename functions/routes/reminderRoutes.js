const express = require("express");
const { sendManualReminder } = require("../controllers/reminderController");
const { protect } = require("../middleware/authMiddleware");
const router = express.Router();
const authorizeRoles = require("../middleware/rolemiddleware");


// 🔹 Route to send reminder for one borrower by ID
// Example: GET /api/reminder/borrower/68b70973f3fa3b05db0298b2
// router.post("/borrower/:borrowerId/loan/:loanId",protect, sendBorrowerLoanReminder);
router.post(
  "/manual",
  protect,
  authorizeRoles("agent", "lender"),
  sendManualReminder
);

module.exports = router;
