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
  getLoanRepaymentReport,
  getDemographicsReport,
  getRegionalPerformanceReport,
  getBusinessTypeReport
} = require("../controllers/reportController");

router.get("/summary",protect, getDashboardReport);
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

router.get("/demographics", protect, getDemographicsReport);
router.get("/regional-performance", protect, getRegionalPerformanceReport);
router.get("/business-type", protect, getBusinessTypeReport);

module.exports = router;
