const express = require("express");
const router = express.Router();
const QRCode = require("qrcode");
const Customer = require("../models/customer");

// Generate QR for a customer accountId
router.get("/qr/:accountId", async (req, res) => {
  try {
    const { accountId } = req.params;

    // 1. Validate account
    const customer = await Customer.findOne({ accountId });
    if (!customer) {
      return res.status(404).json({ message: "Invalid accountId" });
    }

    // 2. Payment URL (THIS is the QR content)
    const paymentUrl = `https://trainsick-felicia-scleritic.ngrok-free.dev/api/pay/${accountId}`;

    // 3. Generate QR as base64 image
    const qrImage = await QRCode.toDataURL(paymentUrl);

    res.status(200).json({
      accountId,
      borrower: customer.fullName,
      paymentUrl,
      qrImage
    });

  } catch (err) {
    console.error("QR error:", err);
    res.status(500).json({ message: "Failed to generate QR" });
  }
});

module.exports = router;
