const express = require("express");
const router = express.Router();
const groupController = require("../controllers/groupController");
const groupLoanController = require("../controllers/groupLoanController");
const groupMonthlyPaymentController = require("../controllers/groupMonthlyPaymentController");
const groupAlertController = require("../controllers/groupAlertController");
const groupReportController = require("../controllers/groupReportController");
const { protect } = require("../middleware/authMiddleware");

router.post("/", protect, groupController.createGroup);
router.post("/add-member", protect, groupController.addMember);
router.post("/:groupId/add-member", protect, groupController.addMember);
router.put("/:groupId/leader", protect, groupController.assignGroupLeader);
router.get("/:groupId/members", protect, groupController.getGroupMembers);
router.get("/:groupId/repayments", protect, groupController.getGroupRepayments);
router.get("/:groupId/group-repayments", protect, groupController.getGroupMonthlyPayments);
router.get("/agent/:agentId", protect, groupController.getGroupsByAgentId);
router.get("/agent-groups/:agentId", protect, groupController.getAgentGroups);
router.get("/all-members", protect, groupController.getAllGroupMembers);

// --- GROUP LOAN REQUESTS ---
router.post("/loan-request", protect, groupLoanController.createGroupLoanRequest);
router.get("/loan-requests/lender", protect, groupLoanController.getLenderGroupLoanRequests);
router.get("/loan-requests/agent", protect, groupLoanController.getAgentGroupLoanRequests); // Agent sees requests for their groups
router.put("/loan-review", protect, groupLoanController.reviewGroupLoanRequest);
router.put("/loan-review/agent", protect, groupLoanController.agentReviewGroupLoanRequest); // Agent review API
router.post("/initiate-repayment", protect, groupLoanController.initiateMemberRepayment);


router.post("/remove-member", protect, groupController.removeMember);
router.get("/analytics", protect, groupController.getGroupAnalytics);
router.get("/leader/:leaderId", groupController.getGroupByLeader);
router.get("/:groupId", protect, groupController.getGroupDetails);
router.put("/:groupId", protect, groupController.updateGroup);
router.put("/:groupId/status", protect, groupController.updateGroupStatus);
router.delete("/:groupId", protect, groupController.deleteGroup);
router.post("/disburse-loan", protect, groupController.disburseGroupLoan);
router.get("/status/pending", protect, groupController.getPendingGroups);
router.put("/:groupId/approve", protect, groupController.approveGroup);
router.get("/", protect, groupController.getLenderGroups);

// --- MONTHLY AGGREGATE REPAYMENTS ---
// 🏦 AGGREGATION & ALERTS (Cron Job triggers)
router.post("/process-monthly-repayments", protect, groupMonthlyPaymentController.processMonthlyGroupRepayments);
router.post("/check-missed-repayments", protect, groupAlertController.checkMissedRepayments);
router.post("/check-group-health", protect, groupAlertController.checkGroupHealth);

// --- ALERT MANAGEMENT ---
router.get("/alerts/group/:group_id", protect, groupAlertController.getGroupAlerts);
router.put("/alerts/resolve/:alert_id", protect, groupAlertController.resolveAlert);
router.put("/alerts/escalate/:alert_id", protect, groupAlertController.escalateAlert);

// --- GROUP LOAN REPORTS ---
router.get("/reports/weekly", protect, groupReportController.getWeeklyGroupReport);
router.get("/reports/monthly", protect, groupReportController.getMonthlyGroupReport);
router.get("/reports/agent/:agentId", protect, groupReportController.getAgentGroupReport);

module.exports = router;
