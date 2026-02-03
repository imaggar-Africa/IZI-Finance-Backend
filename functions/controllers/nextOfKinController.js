const NextOfKin = require("../models/NextOfKin");
const Customer = require("../models/customer");
const { normalizePhone } = require("../utils/normalizePhone");
const OTP = require("../models/OTP");


// --------------------------------------------------
// CREATE Next-of-Kin
// --------------------------------------------------

exports.createNextOfKin = async (req, res) => {
  try {
    const { borrowerId, fullName, idNumber, relationship, phone } = req.body;

    if (!borrowerId || !fullName || !idNumber || !relationship || !phone) {
      return res.status(400).json({
        success: false,
        message: "borrowerId, fullName, idNumber, relationship, phone are required"
      });
    }

    const borrower = await Customer.findById(borrowerId);
    if (!borrower) {
      return res.status(404).json({ success: false, message: "Borrower not found" });
    }

    const normalizedPhone = normalizePhone(phone, "KE");
    if (!normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number"
      });
    }

    const exists = await NextOfKin.findOne({ borrowerId });
    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Next-of-kin already exists. Use update API."
      });
    }

    const nok = await NextOfKin.create({
      borrowerId,
      fullName,
      idNumber,
      relationship,
      phone: normalizedPhone,
      consent: false,
      consent_timestamp: null
    });

    // 🔥 SAME OTP SERVICE AS LOGIN
    const { sendVerificationCode } = req.app.locals.otpService;
    const result = await sendVerificationCode(normalizedPhone);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP"
      });
    }

    // 🧪 LOCAL / HTTP
    if (result.sandbox) {
      return res.status(201).json({
        success: true,
        sandbox: true,
        otp: result.otp,
        message: "Next-of-kin created. OTP generated (sandbox)",
        nextOfKin: nok
      });
    }

    // 🔐 LIVE / HTTPS
    return res.status(201).json({
      success: true,
      message: "Next-of-kin created. OTP sent for consent.",
      nextOfKin: nok
    });

  } catch (err) {
    console.error("Create NOK error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};



exports.verifyNextOfKinOTP = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: "phone and otp are required"
      });
    }

    const normalizedPhone = normalizePhone(phone, "KE");

    const otpRecord = await OTP.findOne({ phone: normalizedPhone });
    if (!otpRecord) {
      return res.status(400).json({ message: "OTP not found" });
    }

    if (otpRecord.expiresAt < new Date()) {
      await OTP.deleteOne({ phone: normalizedPhone });
      return res.status(400).json({ message: "OTP expired" });
    }

    if (otpRecord.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    const nok = await NextOfKin.findOne({ phone: normalizedPhone });
    if (!nok) {
      return res.status(404).json({ message: "Next-of-kin not found" });
    }

    nok.consent = true;
    nok.consent_timestamp = new Date();
    await nok.save();

    // 🧹 cleanup OTP
    await OTP.deleteOne({ phone: normalizedPhone });

    console.log("✅ User gave consent via OTP for IziFinance T&C");

    return res.status(200).json({
      success: true,
      message: "Next-of-kin consent verified successfully"
    });

  } catch (err) {
    console.error("Verify NOK OTP error:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * Resend OTP for Next-of-Kin consent
 */
exports.resendNextOfKinOTP = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "phone is required",
      });
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number",
      });
    }

    // ✅ Check Next-of-Kin exists
    const nok = await NextOfKin.findOne({ phone: normalizedPhone });
    if (!nok) {
      return res.status(404).json({
        success: false,
        message: "Next-of-kin not found",
      });
    }

    // ❌ Already verified
    if (nok.consent === true) {
      return res.status(400).json({
        success: false,
        message: "Next-of-kin already verified",
      });
    }

    // 🧹 Remove old OTP
    await OTP.deleteOne({ phone: normalizedPhone });

    // 🔥 SAME OTP FLOW AS LOGIN
    const { sendVerificationCode } = req.app.locals.otpService;
    const result = await sendVerificationCode(normalizedPhone);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to resend OTP",
      });
    }

    // 🧪 LOCAL / HTTP
    if (result.sandbox) {
      return res.json({
        success: true,
        sandbox: true,
        otp: result.otp,
        message: "OTP resent successfully (sandbox)",
      });
    }

    // 🔐 LIVE / HTTPS
    return res.json({
      success: true,
      message: "OTP resent successfully",
    });

  } catch (err) {
    console.error("Resend NOK OTP error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};


// --------------------------------------------------
// UPDATE Next-of-Kin
// --------------------------------------------------
exports.updateNextOfKin = async (req, res) => {
  try {
    const { borrowerId } = req.params;
    const { fullName, idNumber, relationship } = req.body;

    if (!borrowerId) {
      return res.status(400).json({ message: "borrowerId is required" });
    }

    const nok = await NextOfKin.findOne({ borrowerId });
    if (!nok) {
      return res.status(404).json({
        message: "Next-of-kin not found"
      });
    }

    if (fullName) nok.fullName = fullName;
    if (idNumber) nok.idNumber = idNumber;
    if (relationship) nok.relationship = relationship;

    await nok.save();

    res.json({
      success: true,
      message: "Next-of-kin updated successfully",
      nextOfKin: nok
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// --------------------------------------------------
// GET Next-of-Kin
// --------------------------------------------------
exports.getNextOfKin = async (req, res) => {
  try {
    const { borrowerId } = req.params;

    if (!borrowerId) {
      return res.status(400).json({ message: "borrowerId is required" });
    }

    const nok = await NextOfKin.findOne({ borrowerId });
    if (!nok) {
      return res.status(404).json({
        message: "Next-of-kin not found"
      });
    }

    res.json({
      success: true,
      nextOfKin: nok
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

