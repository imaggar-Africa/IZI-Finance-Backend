// const mongoose = require("mongoose");

// const guarantorSchema = new mongoose.Schema(
//   {
//     borrowerId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//       required: true,
//       index: true,
//     },

//     fullName: {
//       type: String,
//       required: true,
//       trim: true,
//     },

//     phone: {
//       type: String,
//       required: true,
//     },

//     relationship: {
//       type: String,
//       required: true, // friend, brother, spouse etc
//     },

//     idNumber: {
//       type: String,
//       required: true,
//     },

//     isVerified: {
//       type: Boolean,
//       default: false,
//     },

//     isDeleted: {
//       type: Boolean,
//       default: false,
//     },
//   },
//   { timestamps: true }
// );

// // prevent duplicate guarantor per borrower
// guarantorSchema.index(
//   { borrowerId: 1, phone: 1 },
//   { unique: true }
// );

// module.exports = mongoose.model("Guarantor", guarantorSchema);

const mongoose = require("mongoose");

const guarantorSchema = new mongoose.Schema(
  {
    borrowerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "customer",
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

    // 🔥 NEW FIELDS (OTP CONSENT FLOW)
    consent: {
      type: Boolean,
      default: false, // OTP verify ஆன பிறகு true
    },

    consent_timestamp: {
      type: Date,
      default: null, // OTP verify time
    },

    isVerified: {
      type: Boolean,
      default: false, // consent true ஆனதும் update
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
