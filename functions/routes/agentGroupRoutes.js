const express = require("express");
const router = express.Router();
const controller = require("../controllers/agentGroupController");
const { protect } = require("../middleware/authMiddleware");

router.post("/", protect, controller.createAgentGroup);
router.post("/add-member", protect, controller.addMemberByAgent);
router.post("/remove-member", protect, controller.removeMemberByAgent);
router.get("/", protect, controller.getAgentGroups);
router.get("/:groupId", protect, controller.getAgentGroupDetails);

module.exports = router;
