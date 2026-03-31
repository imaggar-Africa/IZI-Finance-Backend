const express = require("express");
const router = express.Router();
const groupController = require("../controllers/groupController");
const groupLoanController = require("../controllers/groupLoanController");
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
router.put("/loan-review", protect, groupLoanController.reviewGroupLoanRequest);
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

module.exports = router;
