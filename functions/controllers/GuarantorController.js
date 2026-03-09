const Guarantor = require("../models/Guarantor");
const Customer = require("../models/customer");
const { normalizePhone } = require("../utils/normalizePhone");
const OTP = require("../models/OTP");


/**
 * Add guarantor (Borrower / Customer)
 */

// exports.addGuarantor = async (req, res) => {
//   try {
//     const { borrowerId, fullName, phone, relationship, idNumber } = req.body;

//     if (!borrowerId || !fullName || !phone || !relationship || !idNumber) {
//       return res.status(400).json({
//         success: false,
//         message: "All guarantor fields are required",
//       });
//     }

//     const borrower = await Customer.findById(borrowerId);
//     if (!borrower) {
//       return res.status(404).json({
//         success: false,
//         message: "Borrower not found",
//       });
//     }

//     const normalizedPhone = normalizePhone(phone, "KE");
//     if (!normalizedPhone) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid phone number",
//       });
//     }

//     const existing = await Guarantor.findOne({
//       borrowerId,
//       phone: normalizedPhone,
//       isDeleted: false,
//     });

//     if (existing) {
//       return res.status(409).json({
//         success: false,
//         message: "Guarantor already exists",
//       });
//     }

//     const guarantor = await Guarantor.create({
//       borrowerId,
//       fullName,
//       phone: normalizedPhone,
//       relationship,
//       idNumber,
//       isVerified: false,
//     });

//     // 🔥 SAME OTP FLOW AS LOGIN
//     const { sendVerificationCode } = req.app.locals.otpService;
//     const result = await sendVerificationCode(normalizedPhone);

//     if (!result.success) {
//       return res.status(500).json({
//         success: false,
//         message: "Failed to send OTP",
//       });
//     }

//     // 🧪 LOCAL / HTTP → show OTP
//     if (result.sandbox) {
//       return res.status(201).json({
//         success: true,
//         sandbox: true,
//         otp: result.otp,
//         message: "Guarantor added. OTP generated (sandbox)",
//         guarantor,
//       });
//     }

//     // 🔐 LIVE / HTTPS
//     return res.status(201).json({
//       success: true,
//       message: "Guarantor added. OTP sent for consent",
//       guarantor,
//     });

//   } catch (error) {
//     console.error("Add guarantor error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Server error",
//     });
//   }
// };




exports.verifyGuarantorOTP = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: "phone and otp are required",
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

    const guarantor = await Guarantor.findOne({
      phone: normalizedPhone,
      isDeleted: false,
    });

    if (!guarantor) {
      return res.status(404).json({ message: "Guarantor not found" });
    }

    guarantor.isVerified = true;
    guarantor.consent = true;
    guarantor.consent_timestamp = new Date();
    await guarantor.save();

    // 🧹 cleanup
    await OTP.deleteOne({ phone: normalizedPhone });

    return res.json({
      success: true,
      message: "Guarantor consent verified successfully",
    });

  } catch (err) {
    console.error("Verify OTP error:", err);
    res.status(500).json({ message: err.message });
  }
};


/**
 * Resend OTP for Guarantor consent
 */
exports.resendGuarantorOTP = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "phone is required",
      });
    }

    const normalizedPhone = normalizePhone(phone, "KE");
    if (!normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number",
      });
    }

    // ✅ Check guarantor exists
    const guarantor = await Guarantor.findOne({
      phone: normalizedPhone,
      isDeleted: false,
    });

    if (!guarantor) {
      return res.status(404).json({
        success: false,
        message: "Guarantor not found",
      });
    }

    // ❌ If already verified, don't resend
    if (guarantor.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Guarantor already verified",
      });
    }

    // 🧹 Remove old OTP
    await OTP.deleteOne({ phone: normalizedPhone });

    // 🔥 SAME OTP SERVICE AS LOGIN
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
    console.error("Resend guarantor OTP error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};


/**
 * Get logged-in borrower's guarantors
 */
exports.getMyGuarantors = async (req, res) => {
  try {
    const guarantors = await Guarantor.find({
      borrowerId: req.user._id,
      isDeleted: false,
    }).sort({ createdAt: -1 });

    res.json(guarantors);
  } catch (error) {
    res.status(500).json({
      message: "Server error",
    });
  }
};

/**
 * Admin: Get guarantors of a borrower
 */
exports.getBorrowerGuarantors = async (req, res) => {
  try {
    const { borrowerId } = req.params;

    const guarantors = await Guarantor.find({
      borrowerId,
      isDeleted: false,
    });

    res.json(guarantors);
  } catch (error) {
    res.status(500).json({
      message: "Server error",
    });
  }
};
