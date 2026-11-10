const OTP = require("../models/OTP");
const User = require("../models/User"); // Assuming you have a User model
const {sendSMS }= require("../utils/sms"); // Function to send SMS
const generateOTP = require("../utils/generateOTP"); // Function to generate OTP
const { isE164, normalizePhone } = require("../utils/phone");




// Send OTP
exports.sendOTP = async (req, res) => {
  try {
    let { phone } = req.body;
    console.log("[OTP] Sending request for phone:", phone);

    if (!phone) {
      console.warn("[OTP] Missing phone in request body");
      return res.status(400).json({ message: "Missing 'phone' in body" });
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      console.warn("[OTP] Invalid phone format:", phone);
      return res.status(400).json({ message: "Invalid phone format" });
    }

    // Get OTP service from app.locals
    if (!req.app.locals.otpService) {
      console.error("[OTP] otpService not found in app.locals. App might not be fully initialized.");
      return res.status(500).json({ 
        message: "OTP Service not initialized", 
        error: "Service unavailable" 
      });
    }

    const { sendVerificationCode } = req.app.locals.otpService;

    if (typeof sendVerificationCode !== 'function') {
      console.error("[OTP] sendVerificationCode is not a function", req.app.locals.otpService);
      return res.status(500).json({ 
        message: "OTP Service configuration error", 
        error: "Invalid service method" 
      });
    }

    console.log("[OTP] Calling sendVerificationCode...");
    const otpResponse = await sendVerificationCode(normalizedPhone);
    console.log("[OTP] sendVerificationCode response:", JSON.stringify(otpResponse));

    if (res.headersSent) {
      console.warn("[OTP] Headers already sent by a previous event/middleware. Skipping controller response.");
      return;
    }

    if (!otpResponse.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP",
        error: otpResponse.message,
        details: otpResponse.error
      });
    }

    const responseData = {
      success: true,
      message: otpResponse.message || "OTP sent successfully",
      phone: otpResponse.phone,
      delivered: otpResponse.delivered
    };

    // Sandbox → OTP included for testing
    if (otpResponse.sandbox) {
      responseData.otp = otpResponse.otp;
    }

    return res.status(200).json(responseData);

  } catch (error) {
    console.error("❌ [OTP] Critical error in sendOTP controller:", error);
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false,
        message: "Server error while sending OTP", 
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  }
};


// Verify OTP
exports.verifyOTPController = async (req, res) => {
  try {
    let { phone, otp } = req.body;
    console.log(`[OTP] Verifying OTP for ${phone}...`);

    if (!phone || !otp) {
      console.warn("[OTP] Missing phone or otp in verify request");
      return res.status(400).json({ message: "Phone and OTP are required" });
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ message: "Invalid phone format" });
    }

    // Get OTP service
    if (!req.app.locals.otpService) {
      console.error("[OTP] otpService not found in app.locals during verification");
      return res.status(500).json({ message: "OTP Service not initialized" });
    }

    const { verifyOTP } = req.app.locals.otpService;

    const result = await verifyOTP(normalizedPhone, otp);
    console.log(`[OTP] Verification result for ${normalizedPhone}:`, JSON.stringify(result));

    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }

    return res.json({ message: result.message });

  } catch (error) {
    console.error("❌ [OTP] Error verifying OTP:", error);
    res.status(500).json({ 
      message: "Server error while verifying OTP",
      error: error.message
    });
  }
};
