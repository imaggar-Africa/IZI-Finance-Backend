const express = require("express");
const router = express.Router();
const groupController = require("../controllers/groupController");
const { protect } = require("../middleware/authMiddleware");

router.post("/", protect, groupController.createGroup);
router.post("/add-member", protect, groupController.addMember);
router.post("/remove-member", protect, groupController.removeMember);
router.get("/analytics", protect, groupController.getGroupAnalytics);
router.get("/:groupId", protect, groupController.getGroupDetails);
router.put("/:groupId", protect, groupController.updateGroup);
router.delete("/:groupId", protect, groupController.deleteGroup);
router.get("/", protect, groupController.getLenderGroups);

module.exports = router;
