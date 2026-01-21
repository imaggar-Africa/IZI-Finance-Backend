const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");

const {
  getDashboardReport,
  getLoansReport,
  getRepaymentsReport,
  getProfitReport,
  getBorrowersReport,
  getAgentsReport,
  getAuditLogs,
  getLoanRepaymentReport
} = require("../controllers/reportController");

router.get("/dashboard",protect, getDashboardReport);
router.get("/loans",protect, getLoansReport);
router.get("/repayments",protect, getRepaymentsReport);
router.get("/profit",protect, getProfitReport);
router.get("/borrowers",protect, getBorrowersReport);
router.get("/agents",protect, getAgentsReport);
router.get("/audit-logs",protect, getAuditLogs);
router.get(
  "/loan-repayment",
  protect,
  getLoanRepaymentReport
);


module.exports = router;
