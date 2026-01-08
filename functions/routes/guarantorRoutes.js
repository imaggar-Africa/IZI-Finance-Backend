const express = require("express");
const router = express.Router();

const guarantorController = require("../controllers/guarantorController");
const { protect } = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/rolemiddleware");

// borrower adds guarantor
router.post(
  "/",
  protect,
  authorizeRoles("lender", "agent"),
  guarantorController.addGuarantor
);

// borrower lists own guarantors
router.get(
  "/",
  protect,
  authorizeRoles("borrower"),
  guarantorController.getMyGuarantors
);

// admin list guarantors of borrower
router.get(
  "/borrower/:borrowerId",
  protect,
  authorizeRoles("lender", "agent"),
  guarantorController.getBorrowerGuarantors
);

module.exports = router;
