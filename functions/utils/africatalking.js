const OTP = require("../models/OTP");
const { sendSMS } = require("./sms");

function africasTalkingService({ atUsername, atApiKey, atSenderId }) {
  // ... parameters kept for compatibility but sending is handled by smsQueue now

  const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

  async function sendVerificationCode(phone) {
    try {
      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      // Always save OTP to DB first
      await OTP.findOneAndUpdate(
        { phone },
        { otp, expiresAt },
        { upsert: true, new: true }
      );

      console.log(`📌 OTP generated and saved for ${phone}: ${otp}`);

      // ⚡ ENQUEUE SMS (using the unified background system)
      const messageText = `Your Izifinance verification code is: ${otp}. Valid for 5 minutes.`;

      const smsResponse = await sendSMS(phone, messageText);

      return {
        success: true, 
        phone,
        delivered: smsResponse.success,
        message: smsResponse.success 
          ? "OTP queued for delivery" 
          : "OTP saved but background queuing failed",
        error: smsResponse.error || null,
        otp: process.env.NODE_ENV === "development" ? otp : undefined,
      };

    } catch (error) {
      console.error("❌ SMS background sending error:", error.message);
      
      // Still return success if DB save worked, but indicate delivery error
      return {
        success: true, 
        phone,
        delivered: false,
        message: "OTP saved but SMS background enqueue failed",
        error: error.message,
        otp: process.env.NODE_ENV === "development" ? otp : undefined,
      };
    }
  }






 


  // -------------------------------
  // Verify OTP
  // -------------------------------
  async function verifyOTP(phone, otp) {
    try {
      if (!phone || !otp)
        return { success: false, message: "Phone and OTP are required" };

      const record = await OTP.findOne({ phone });
      if (!record) return { success: false, message: "OTP not found" };

      if (record.expiresAt < new Date())
        return { success: false, message: "OTP expired" };

      if (record.otp !== otp)
        return { success: false, message: "Invalid OTP" };

      await OTP.deleteOne({ phone });

      return { success: true, message: "OTP verified successfully" };
    } catch (err) {
      console.error("Error verifying OTP:", err);
      return { success: false, message: "Failed to verify OTP" };
    }
  }

  return {
    sendVerificationCode,
    verifyOTP,
  };
}

module.exports = africasTalkingService;  