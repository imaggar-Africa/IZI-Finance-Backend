const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");


const { protect } = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/rolemiddleware");
const { validateAfricaPhone } = require("../middleware/validateAfricaPhone");
const firebaseSafeUpload = require("../utils/upload");

// Register a new user
router.post("/register",validateAfricaPhone,authController.register);

// Login user
router.post("/login",validateAfricaPhone, authController.login);

// Refersh Token 
router.post("/refresh", authController.refresh); 

// Route for uploading ID verification images
router.post(
  "/upload-id-verification",
  protect,
  authorizeRoles("lender"),
  firebaseSafeUpload([
    { name: "selfie", maxCount: 1 },
    { name: "frontID", maxCount: 1 },
    { name: "backID", maxCount: 1 },
  ]),
  
  authController.uploadLenderIDVerification
);
// Send verification code
router.post("/send-verification-code",validateAfricaPhone, authController.sendVerificationCode);

// Verify phone number
router.post("/verify-phone",validateAfricaPhone, authController.verifyPhoneNumber);

// forgortpasword

router.post("/forgot-password", authController.forgotPassword);

router.post("/reset-password", authController.resetPassword)

// User must be authenticated
router.delete("/users/:id", protect, authController.deleteUser);

module.exports = router; 