const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/rolemiddleware");

const {
  createNextOfKin,
  updateNextOfKin,
  getNextOfKin,
  verifyNextOfKinOTP,
  resendNextOfKinOTP
} = require("../controllers/nextOfKinController");

// CREATE (Agent/Lender only)
router.post(
  "/",
  protect,
  authorizeRoles("agent", "lender"),
  createNextOfKin
);

router.post(
  "/verify-otp",
  protect,
  verifyNextOfKinOTP
);

// RESEND OTP
router.post(
  "/resend-otp",
  protect,
  resendNextOfKinOTP
);


// UPDATE (Agent/Lender only)
router.put(
  "/:borrowerId",
  protect,
  authorizeRoles("agent", "lender"),
  updateNextOfKin
);

// GET (Agent/Lender only)
router.get(
  "/:borrowerId",
  protect,
  authorizeRoles("agent", "lender"),
  getNextOfKin
);

module.exports = router;
