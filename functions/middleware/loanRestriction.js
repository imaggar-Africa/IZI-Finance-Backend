const User = require("../models/User");

module.exports = async (req, res, next) => {
  try {
    const lenderId = req.user._id;

    const lender = await User.findById(lenderId);

    if (!lender) {
      return res.status(404).json({ message: "Lender not found" });
    }

    if (lender.isDeleted) {
      return res.status(403).json({ message: "Account is deleted" });
    }

    // 🔒 Company KYC restriction
    if (
      lender.accountType === "company" &&
      lender.kycStatus !== "approved"
    ) {
      return res.status(403).json({
        message: "Company KYC not approved. Cannot perform loan operations."
      });
    }

    next();

  } catch (err) {
    console.error("Loan restriction error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
