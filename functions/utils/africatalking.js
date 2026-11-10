const OTP = require("../models/OTP");
const { sendSMS } = require("./sms");

function africasTalkingService({ atUsername, atApiKey, atSenderId }) {
  // ... parameters kept for compatibility but sending is handled by smsQueue now

  const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

  async function sendVerificationCode(phone) {
    let otp;
    try {
      otp = generateOTP();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      console.log(`🔑 [AT Service] Generated OTP for ${phone}: ${otp}`);

      // Always save OTP to DB first
      try {
        await OTP.findOneAndUpdate(
          { phone },
          { otp, expiresAt },
          { upsert: true, new: true }
        );
        console.log(`[AT Service] ✅ OTP saved to DB for ${phone}`);
      } catch (dbError) {
        console.error(`[AT Service] ❌ Database error saving OTP for ${phone}:`, dbError.message);
        throw new Error(`Database error: ${dbError.message}`);
      }

      // ⚡ ENQUEUE SMS
      const messageText = `Your Izifinance verification code is: ${otp}. Valid for 5 minutes.`;
      
      console.log(`[AT Service] Enqueueing SMS for ${phone}...`);
      const smsResponse = await sendSMS(phone, messageText);

      if (smsResponse.success) {
        console.log(`[AT Service] ✅ SMS successfully queued for ${phone}`);
      } else {
        console.warn(`[AT Service] ⚠️ SMS queueing reported failure for ${phone}:`, smsResponse.message || smsResponse.error);
      }

      return {
        success: smsResponse.success, 
        phone,
        delivered: smsResponse.success,
        message: smsResponse.success 
          ? "OTP queued for delivery" 
          : "OTP saved but background queuing failed",
        error: smsResponse.error || smsResponse.message || null,
        otp: process.env.NODE_ENV === "development" ? otp : undefined,
      };

    } catch (error) {
      console.error(`[AT Service] ❌ Critical failure in sendVerificationCode for ${phone}:`, error.message);
      
      return {
        success: false, // Changed to false because something actually failed
        phone,
        delivered: false,
        message: error.message || "Internal error in OTP service",
        error: error.message,
        otp: (process.env.NODE_ENV === "development" && otp) ? otp : undefined,
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