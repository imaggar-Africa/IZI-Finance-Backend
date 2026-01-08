const Profile = require('../models/Profile');
const User = require("../models/User");
const uploadToFirebase = require("../utils/uploadToFirebase");

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
    // Role safety (extra guard)
    if (req.user.role !== "lender") {
      return res.status(403).json({
        message: "Access denied: Only lenders can update profile",
      });
    }

    const lenderId = req.user._id;
    const { fullName, idNumber } = req.body;

    // Find existing profile
    const profile = await Profile.findOne({ userId: lenderId });
    if (!profile) {
      return res.status(404).json({
        message: "Profile not found. Please complete ID verification first.",
      });
    }

    // Prevent duplicate ID numbers
    if (idNumber) {
      const existingID = await Profile.findOne({
        idNumber,
        userId: { $ne: lenderId },
      });

      if (existingID) {
        return res.status(409).json({
          message: "This ID number is already registered by another lender.",
        });
      }
    }

    // Update basic fields
    if (fullName) profile.fullName = fullName;
    if (idNumber) profile.idNumber = idNumber;

    // Keep phone synced from User model
    const lender = await User.findById(lenderId).select("+phone");
    if (lender?.phone) {
      profile.phone = lender.phone;
    }

    // Optional file uploads
    if (req.files?.selfie?.[0]) {
      profile.selfie = await uploadToFirebase(
        req.files.selfie[0],
        "lenderid_verify_selfie",
        "lenders"
      );
    }

    if (req.files?.frontID?.[0]) {
      profile.frontID = await uploadToFirebase(
        req.files.frontID[0],
        "lenderid_verify_frontID",
        "lenders"
      );
    }

    if (req.files?.backID?.[0]) {
      profile.backID = await uploadToFirebase(
        req.files.backID[0],
        "lenderid_verify_backID",
        "lenders"
      );
    }

    // Mark as pending review again if sensitive data changed
    if (idNumber || req.files) {
      profile.isVerified = false;
    }

    await profile.save();

    return res.status(200).json({
      message: "Lender profile updated successfully",
      profile,
    });
  } catch (error) {
    console.error("Error updating lender profile:", error);
    return res.status(500).json({
      message: "Server error while updating lender profile",
      error: error.message,
    });
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