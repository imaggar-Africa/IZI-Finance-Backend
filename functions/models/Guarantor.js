const mongoose = require("mongoose");

const guarantorSchema = new mongoose.Schema(
  {
    borrowerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
    },

    relationship: {
      type: String,
      required: true, // friend, brother, spouse etc
    },

    idNumber: {
      type: String,
      required: true,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// prevent duplicate guarantor per borrower
guarantorSchema.index(
  { borrowerId: 1, phone: 1 },
  { unique: true }
);

module.exports = mongoose.model("Guarantor", guarantorSchema);
