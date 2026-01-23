const express = require("express");
const router = express.Router();
const { generateMpesaQR } = require("../controllers/qrController");
const { protect } = require("../middleware/authMiddleware");

// Protected (lender / agent / admin)
router.post("/mpesa", protect, generateMpesaQR);

module.exports = router;
