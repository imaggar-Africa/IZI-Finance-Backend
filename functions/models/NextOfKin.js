// const mongoose = require("mongoose");

// const nextOfKinSchema = new mongoose.Schema(
//   {
//     borrowerId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Customer",
//       required: true,
//       unique: true   // 🔒 ONE next-of-kin per borrower
//     },

//     fullName: {
//       type: String,
//       required: true,
//       trim: true
//     },

//     idNumber: {
//       type: String,
//       required: true,
//       trim: true
//     },

//     relationship: {
//       type: String,
//       required: true,
//       enum: ["Spouse", "Parent", "Sibling", "Child", "Relative", "Friend", "Other"]
//     }
//   },
//   { timestamps: true }
// );

// module.exports = mongoose.model("NextOfKin", nextOfKinSchema);


const mongoose = require("mongoose");

const nextOfKinSchema = new mongoose.Schema(
  {
    borrowerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      unique: true, // 🔒 ONE next-of-kin per borrower
    },

    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true, // 🔥 OTP send panna use ஆகும்
    },

    idNumber: {
      type: String,
      required: true,
      trim: true,
    },

    relationship: {
      type: String,
      required: true,
      enum: ["Spouse", "Parent", "Sibling", "Child", "Relative", "Friend", "Other"],
    },

    // 🔥 OTP CONSENT FIELDS
    consent: {
      type: Boolean,
      default: false, // OTP verify ஆன பிறகு true
    },

    consent_role: {
      type: String,
      default: "next_of_kin",
      immutable: true,
    },

    consent_timestamp: {
      type: Date,
      default: null, // OTP verify time
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("NextOfKin", nextOfKinSchema);
