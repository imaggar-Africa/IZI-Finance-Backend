const mongoose = require("mongoose");

const companyKycSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true
    },

    companyName: {
      type: String,
      required: true,
      trim: true
    },

    registrationNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },

    countryOfRegistration: {
      type: String,
      required: true
    },

    certificateUrl: {
      type: String,
      required: true
    },

    signatoryName: {
      type: String,
      required: true
    },

    signatoryIdNumber: {
      type: String,
      required: true
    },

    signatoryPhone: {
      type: String,
      required: true
    },

    signatoryEmail: {
      type: String,
      required: true
    },

    signatoryIdDocumentUrl: {
      type: String,
      required: true
    },

    bankAccountNumber: {
      type: String,
      required: true
    },

    accountName: {
      type: String,
      required: true
    },

    companyLogoUrl: String,
    website: String,

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("CompanyKYC", companyKycSchema);
