const express = require("express");
const router = express.Router();

const {
  sendAirtel,
  airtelCallback,
} = require("../controllers/airtelController");

// Send money
router.post("/send", sendAirtel);

// Airtel callback (Webhook)
router.post("/callback", airtelCallback);

module.exports = router;
