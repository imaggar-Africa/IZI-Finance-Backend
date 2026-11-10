const { sendSMS } = require("./sms");
const OTP = require("../models/OTP");

exports.send = async (phone, role) => {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  console.log(`🔑 [africatalkingOtp] Generated OTP for ${phone} (${role || 'default'}): ${otp}`);

  // 🔁 Remove old OTP for same phone + role
  await OTP.deleteMany({ phone, purpose: role });

  // ✅ Save OTP (FIELD NAME FIXED)
  await OTP.create({
    phone,
    otp,                 // ✅ FIXED
    purpose: role,
    isUsed: false,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  let message = "";

  if (role === "next_of_kin") {
    message = `IziFinance Consent Code

Hello, you have been listed as NEXT OF KIN for a borrower on IziFinance.
By sharing this code, you confirm that you:
- Agree to share your information
- Are aware of the borrower’s loan process
- Accept IziFinance Terms & Conditions

Your Verification Code: ${otp}
Do NOT share this code unless you agree.`;
  } 
  else if (role === "guarantor") {
    message = `IziFinance Consent Code

Hello, you have been listed as a GUARANTOR for a borrower on IziFinance.
By sharing this code, you confirm that you:
- Agree to share your information
- Understand the borrower’s loan process
- Accept IziFinance Terms & Conditions

Your Verification Code: ${otp}
Do NOT share this code unless you agree.`;
  } 
  else {
    message = `Your IziFinance OTP is ${otp}`;
  }

  await sendSMS(phone, message);

  return { success: true };
};
