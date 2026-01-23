const QRCode = require("qrcode");

/**
 * Generate M-Pesa PayBill QR
 * Works for LIVE + SANDBOX
 */
exports.generateMpesaQR = async (req, res) => {
  try {
    const { billRefNumber, amount } = req.body;

    if (!billRefNumber) {
      return res.status(400).json({
        success: false,
        message: "billRefNumber is required"
      });
    }

    const paybill = process.env.MPESA_SHORTCODE; // 4955880

    /**
     * M-Pesa QR Payload Format (industry standard)
     * LIPA|PB|<PayBill>|<Account>|<Amount?>
     */
    const qrPayload = [
      "LIPA",
      "PB",
      paybill,
      billRefNumber,
      amount || ""
    ].join("|");

    // Generate QR image (base64)
    const qrImage = await QRCode.toDataURL(qrPayload);

    return res.status(200).json({
      success: true,
      type: "MPESA_PAYBILL_QR",
      payload: qrPayload,
      paybill,
      billRefNumber,
      amount: amount || null,
      qrImage
    });

  } catch (error) {
    console.error("❌ QR generation error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate QR"
    });
  }
};
