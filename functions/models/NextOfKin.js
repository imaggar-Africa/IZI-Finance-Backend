const mongoose = require("mongoose");

const nextOfKinSchema = new mongoose.Schema(
  {
    borrowerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      unique: true   // 🔒 ONE next-of-kin per borrower
    },

    fullName: {
      type: String,
      required: true,
      trim: true
    },

    idNumber: {
      type: String,
      required: true,
      trim: true
    },

    relationship: {
      type: String,
      required: true,
      enum: ["Spouse", "Parent", "Sibling", "Child", "Relative", "Friend", "Other"]
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("NextOfKin", nextOfKinSchema);
