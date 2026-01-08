const mongoose = require("mongoose");

const borrowerBusinessProfileSchema = new mongoose.Schema(
  {
    borrowerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer", // ✅ FIXED
      required: true,
      unique: true
    },

    businessType: {
      type: String,
      required: true
    },

    otherBusinessType: {
      type: String
    },

    averageDailySales: {
      type: Number,
      required: true,
      min: 0
    },

    operatingDaysPerWeek: {
      type: Number,
      required: true,
      min: 1,
      max: 7
    },

    yearsInBusiness: {
      type: Number,
      required: true,
      min: 0
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "BorrowerBusinessProfile",
  borrowerBusinessProfileSchema
);
