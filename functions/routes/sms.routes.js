const express = require("express");
const { testSMS } = require("../controllers/sms.controller");
const router = express.Router();

router.post("/send-sms", testSMS);

module.exports = router;