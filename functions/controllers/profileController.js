const Profile = require('../models/Profile');
const User = require("../models/User");
const uploadToFirebase = require("../utils/uploadToFirebase");
const bcrypt = require("bcryptjs");

exports.getProfile = async (req, res) => {
  try {
    const profile = await Profile.findOne({ userId: req.user._id })
      .populate({
        path: "userId",
        select: "-password -__v" // exclude password & version field
      });
    if (!profile) return res.status(404).json({ message: 'Profile not found' });

    res.json(profile);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
};

exports.updateLenderProfile = async (req, res) => {
  try {
    console.log("PUT PROFILE HIT");
    console.log("BODY:", req.body);
    console.log("FILES:", req.files);

    if (req.user.role !== "lender") {
      return res.status(403).json({ message: "Only lenders allowed" });
    }

    const profile = await Profile.findOne({ userId: req.user._id });
    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    let changed = false;

    if (req.body.fullName && req.body.fullName !== profile.fullName) {
      profile.fullName = req.body.fullName;
    }

    if (req.body.idNumber && req.body.idNumber !== profile.idNumber) {
      const exists = await Profile.findOne({
        idNumber: req.body.idNumber,
        userId: { $ne: req.user._id },
      });

      if (exists) {
        return res.status(409).json({ message: "ID already exists" });
      }

      profile.idNumber = req.body.idNumber;
      changed = true;
    }

    if (req.files?.selfie?.[0]) {
      const url = await uploadToFirebase(
        req.files.selfie[0],
        "lender_selfie",
        "lenders"
      );
      if (!url) return res.status(400).json({ message: "Selfie upload failed" });
      profile.selfie = url;
      changed = true;
    }

    if (req.files?.frontID?.[0]) {
      const url = await uploadToFirebase(
        req.files.frontID[0],
        "lender_frontID",
        "lenders"
      );
      if (!url) return res.status(400).json({ message: "Front ID upload failed" });
      profile.frontID = url;
      changed = true;
    }

    if (req.files?.backID?.[0]) {
      const url = await uploadToFirebase(
        req.files.backID[0],
        "lender_backID",
        "lenders"
      );
      if (!url) return res.status(400).json({ message: "Back ID upload failed" });
      profile.backID = url;
      changed = true;
    }

    if (changed) {
      profile.isVerified = false;
    }

    await profile.save();

    return res.json({
      message: "Profile updated",
      profile,
    });
  } catch (err) {
    console.error("UPDATE ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};


exports.getCustomerProfile = async (req, res) => {
    try {
      const { phone } = req.params; // Get phone from request URL
  
      const customer = await Profile.findOne({ phone });
  
      if (!customer) return res.status(404).json({ message: "Customer not found" });
  
      res.json(customer);
    } catch (error) {
      res.status(500).json({ message: "Server error", error });
    }
};

// exports.changeLenderPassword = async (req, res) => {
//   try {
//     if (req.user.role !== "lender") {
//       return res.status(403).json({ message: "Only lenders allowed" });
//     }

//     const { currentPassword, newPassword } = req.body;

//     if (!currentPassword || !newPassword) {
//       return res.status(400).json({ 
//         message: "Current password and new password are required" 
//       });
//     }

//     if (newPassword.length < 6) {
//       return res.status(400).json({
//         message: "New password must be at least 6 characters"
//       });
//     }

//     const user = await User.findById(req.user._id).select("+password");
//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     const isMatch = await bcrypt.compare(currentPassword, user.password);
//     if (!isMatch) {
//       return res.status(400).json({ message: "Current password is incorrect" });
//     }

//     const salt = await bcrypt.genSalt(10);
//     user.password = await bcrypt.hash(newPassword, salt);

//     await user.save();

//     return res.json({ message: "Password updated successfully" });

//   } catch (error) {
//     console.error("Password change error:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };