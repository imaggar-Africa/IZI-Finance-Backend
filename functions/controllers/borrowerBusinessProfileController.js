const BorrowerBusinessProfile = require("../models/BorrowerBusinessProfile");
const Customer = require("../models/customer");

const ALLOWED_BUSINESS_TYPES = [
  "Retail shop / Kiosk",
  "Market trader",
  "Food vendor",
  "Farming / Agriculture",
  "Livestock / Poultry / Fish farming",
  "Salon / Barbershop",
  "Transport",
  "Small services",
  "Other",
];

// --------------------------------------------------
// CREATE Business Profile
// --------------------------------------------------
exports.createBusinessProfile = async (req, res) => {
  try {
    const { borrowerId } = req.params;
    const {
      businessType,
      otherBusinessType,
      averageDailySales,
      operatingDaysPerWeek,
      yearsInBusiness,
    } = req.body;

    // ✅ Validate borrower from Customer
    const borrower = await Customer.findById(borrowerId);
    if (!borrower) {
      return res.status(404).json({ error: "Borrower not found" });
    }

    const existing = await BorrowerBusinessProfile.findOne({ borrowerId });
    if (existing) {
      return res.status(409).json({
        error: "Business profile already exists for this borrower",
      });
    }

    if (!ALLOWED_BUSINESS_TYPES.includes(businessType)) {
      return res.status(400).json({ error: "Invalid businessType" });
    }

    if (businessType === "Other" && !otherBusinessType?.trim()) {
      return res.status(400).json({
        error: "otherBusinessType is required when businessType is Other",
      });
    }

    const profile = new BorrowerBusinessProfile({
      borrowerId,
      businessType,
      otherBusinessType:
        businessType === "Other" ? otherBusinessType.trim() : undefined,
      averageDailySales,
      operatingDaysPerWeek,
      yearsInBusiness,
    });

    await profile.save();

    res.status(201).json({
      message: "Borrower business profile created successfully",
      profile,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// --------------------------------------------------
// GET Business Profile
// --------------------------------------------------
exports.getBusinessProfile = async (req, res) => {
  try {
    const { borrowerId } = req.params;

    const profile = await BorrowerBusinessProfile.findOne({ borrowerId });
    if (!profile) {
      return res.status(404).json({ error: "Business profile not found" });
    }

    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// --------------------------------------------------
// UPDATE Business Profile
// --------------------------------------------------
exports.updateBusinessProfile = async (req, res) => {
  try {
    const { borrowerId } = req.params;
    const {
      businessType,
      otherBusinessType,
      averageDailySales,
      operatingDaysPerWeek,
      yearsInBusiness,
    } = req.body;

    // ✅ Validate borrower from Customer
    const borrower = await Customer.findById(borrowerId);
    if (!borrower) {
      return res.status(404).json({ error: "Borrower not found" });
    }

    const profile = await BorrowerBusinessProfile.findOne({ borrowerId });
    if (!profile) {
      return res.status(404).json({ error: "Business profile not found" });
    }

    if (businessType) {
      if (!ALLOWED_BUSINESS_TYPES.includes(businessType)) {
        return res.status(400).json({ error: "Invalid businessType" });
      }

      profile.businessType = businessType;
      profile.otherBusinessType =
        businessType === "Other" ? otherBusinessType?.trim() : undefined;
    }

    if (averageDailySales !== undefined) {
      if (averageDailySales < 0) {
        return res.status(400).json({ error: "averageDailySales must be >= 0" });
      }
      profile.averageDailySales = averageDailySales;
    }

    if (operatingDaysPerWeek !== undefined) {
      if (operatingDaysPerWeek < 1 || operatingDaysPerWeek > 7) {
        return res.status(400).json({
          error: "operatingDaysPerWeek must be between 1 and 7",
        });
      }
      profile.operatingDaysPerWeek = operatingDaysPerWeek;
    }

    if (yearsInBusiness !== undefined) {
      if (yearsInBusiness < 0) {
        return res.status(400).json({
          error: "yearsInBusiness must be >= 0",
        });
      }
      profile.yearsInBusiness = yearsInBusiness;
    }

    await profile.save();

    res.json({
      message: "Borrower business profile updated successfully",
      profile,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
