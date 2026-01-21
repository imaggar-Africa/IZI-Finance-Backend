const express = require("express");
const router = express.Router();

/**
 * MOCK: Vodacom OAuth
 */
router.get("/oauth", (req, res) => {
  return res.status(200).json({
    access_token: "dummy_vodacom_access_token_123456",
    expires_in: 3600
  });
});

/**
 * MOCK: Vodacom STK Push
 */
router.post("/stkpush", (req, res) => {
  return res.status(200).json({
    MerchantRequestID: "DUMMY-MERCHANT-001",
    CheckoutRequestID: "DUMMY-CHECKOUT-001",
    ResponseCode: "0",
    ResponseDescription: "Success. Request accepted for processing",
    CustomerMessage: "STK Push initiated successfully"
  });
});

/**
 * MOCK: Vodacom Callback
 */
router.post("/stk/callback", (req, res) => {
  console.log("VODACOM CALLBACK:", req.body);
  return res.json({
    ResultCode: 0,
    ResultDesc: "Accepted"
  });
});

module.exports = router;
