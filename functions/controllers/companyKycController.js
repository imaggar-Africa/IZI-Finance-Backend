const CompanyKYC = require("../models/CompanyKYC");
const User = require("../models/User");
const uploadToFirebase = require("../utils/uploadToFirebase");

exports.submitCompanyKYC = async (req, res) => {
  try {
    if (req.user.accountType !== "company") {
      return res.status(403).json({ message: "Only company accounts allowed" });
    }

    const userId = req.user._id;

    const {
      companyName,
      registrationNumber,
      countryOfRegistration,
      signatoryName,
      signatoryIdNumber,
      signatoryPhone,
      signatoryEmail,
      bankAccountNumber,
      accountName,
      website
    } = req.body;

    if (!companyName || !accountName) {
      return res.status(400).json({ message: "Company name and account name required" });
    }

    if (
      companyName.trim().toLowerCase() !==
      accountName.trim().toLowerCase()
    ) {
      return res.status(400).json({
        message: "Bank account name must match company name"
      });
    }

    // 🔥 Required file validation
    if (!req.files?.certificate?.[0]) {
      return res.status(400).json({ message: "Certificate file is required" });
    }

    if (!req.files?.signatoryId?.[0]) {
      return res.status(400).json({ message: "Signatory ID document is required" });
    }

    const existing = await CompanyKYC.findOne({ userId });
    if (existing) {
      return res.status(400).json({ message: "KYC already submitted" });
    }

    const certificateUrl = await uploadToFirebase(
      req.files.certificate[0],
      "company_certificate",
      "company"
    );

    const signatoryIdDocumentUrl = await uploadToFirebase(
      req.files.signatoryId[0],
      "signatory_id",
      "company"
    );

    let companyLogoUrl = null;

    if (req.files?.companyLogo?.[0]) {
      companyLogoUrl = await uploadToFirebase(
        req.files.companyLogo[0],
        "company_logo",
        "company"
      );
    }

    const newKyc = await CompanyKYC.create({
      userId,
      companyName,
      registrationNumber,
      countryOfRegistration,
      certificateUrl,
      signatoryName,
      signatoryIdNumber,
      signatoryPhone,
      signatoryEmail,
      signatoryIdDocumentUrl,
      bankAccountNumber,
      accountName,
      companyLogoUrl,
      website
    });

    await User.findByIdAndUpdate(userId, {
      kycStatus: "pending"
    });

    return res.status(201).json({
      message: "Company KYC submitted. Awaiting admin approval.",
      kyc: newKyc
    });

  } catch (error) {
    console.error("Company KYC error:", error);
    return res.status(500).json({ message: error.message });
  }
};


exports.reviewCompanyKYC = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin only" });
    }

    const { kycId, action } = req.body;

    if (!["approved", "rejected"].includes(action)) {
      return res.status(400).json({ message: "Invalid action" });
    }

    const kyc = await CompanyKYC.findById(kycId);
    if (!kyc) {
      return res.status(404).json({ message: "KYC not found" });
    }

    kyc.status = action;
    await kyc.save();

    await User.findByIdAndUpdate(kyc.userId, {
      kycStatus: action
    });

    return res.json({
      message: `Company KYC ${action} successfully`
    });

  } catch (error) {
    console.error("Review error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
