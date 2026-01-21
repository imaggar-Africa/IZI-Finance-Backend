const express = require("express");
const router = express.Router();
const {
  getDashboardReport,
  getLoansReport,
  getRepaymentsReport,
  getProfitReport,
  getBorrowersReport,
  getAgentsReport,
  getAuditLogs
} = require("../controllers/reportController");

router.get("/dashboard", getDashboardReport);
router.get("/loans", getLoansReport);
router.get("/repayments", getRepaymentsReport);
router.get("/profit", getProfitReport);
router.get("/borrowers", getBorrowersReport);
router.get("/agents", getAgentsReport);
router.get("/audit-logs", getAuditLogs);

module.exports = router;
