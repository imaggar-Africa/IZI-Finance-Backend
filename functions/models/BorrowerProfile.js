const mongoose = require("mongoose");

const borrowerProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    fullName: {
      type: String,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    idNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // 🔹 New Location Fields
    market: {
      type: String,
      trim: true,
    },

    town: {
      type: String,
      trim: true,
    },

    // 🔹 Borrower Status
    status: {
      type: String,
      enum: ["Draft", "Active", "Inactive"],
      default: "Draft",
    },

    frontID: String,
    backID: String,
    livePhoto: String,

    isVerified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * 🔐 Conditional Validation
 * Status = Active → market & town mandatory
 */
borrowerProfileSchema.pre("save", function (next) {
  if (this.status === "Active") {
    if (!this.market || !this.town) {
      return next(
        new Error("Market and Town are required when borrower status is Active")
      );
    }
  }
  next();
});

module.exports = mongoose.model("BorrowerProfile", borrowerProfileSchema);
