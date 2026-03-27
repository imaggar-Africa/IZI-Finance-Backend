const express = require("express");
const router = express.Router();
const lenderController = require("../controllers/lenderController");
const authorizeRoles = require("../middleware/rolemiddleware");
const { protect } = require("../middleware/authMiddleware");

const firebaseSafeUpload = require("../utils/upload");
// Send money to borrower
router.post("/send-money", lenderController.sendMoneyToBorrower);
router.get("/customers", protect, authorizeRoles("lender"),lenderController.getAllCustomersForLender);
router.post("/assign-customer", protect, authorizeRoles("lender"), lenderController.assignCustomerToAgent);
router.get("/agents", protect,authorizeRoles("lender"), lenderController.getAgentsByLender);
router.put("/agent/:agentId", protect,authorizeRoles("lender"), lenderController.editAgent);
router.delete("/agent/:agentId", protect,authorizeRoles("lender"), lenderController.removeAgent);
router.patch("/agent/:agentId/enforce", protect, authorizeRoles("lender"), lenderController.enforceAgent);

router.patch(
  "/selfie-update",
  protect,
  authorizeRoles("lender"),
  firebaseSafeUpload([{ name: "selfie", maxCount: 1 }]),
  lenderController.updateSelfie
);

module.exports = router;
