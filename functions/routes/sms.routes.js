const express = require("express");
const {
  testSMS,
  getSmsQueue,
  retrySmsMessage,
  retryAllFailedOrWaiting,
} = require("../controllers/sms.controller");
const router = express.Router();

// Existing test SMS route
router.post("/send-sms", testSMS);

// Audit & Queue Management Routes
router.get("/queue", getSmsQueue);
router.post("/retry/:id", retrySmsMessage);
router.post("/retry-all", retryAllFailedOrWaiting);

module.exports = router;