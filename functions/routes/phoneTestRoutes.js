const express = require("express");
const router = express.Router();
const { normalizePhone } = require("../utils/normalizePhone");

/**
 * POST /api/phone/test
 * Body: { phone: string }
 */
router.post("/test", (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({
      success: false,
      message: "Phone number is required"
    });
  }

  const normalized = normalizePhone(phone);

  if (!normalized) {
    return res.status(400).json({
      success: false,
      message: "Invalid or unsupported phone number",
      input: phone
    });
  }

  return res.status(200).json({
    success: true,
    input: phone,
    normalized,
    countryCode: normalized.slice(0, 4) // quick visibility
  });
});

module.exports = router;
