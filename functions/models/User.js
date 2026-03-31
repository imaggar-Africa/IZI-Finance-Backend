const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { normalizePhone } = require("../utils/normalizePhone");

// E.164 phone format: +{country}{national} up to 15 digits total
const E164 = /^\+[1-9]\d{1,14}$/;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true
    },
   accountType: {
  type: String,
  enum: ["individual", "company"],
  required: true
},

kycStatus: {
  type: String,
  enum: ["pending", "approved", "rejected"],
  default: "pending"
},


    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      validate: {
        validator: (v) => E164.test(v),
        message: (props) => `${props.value} is not a valid E.164 phone number`
      }
    },

    // Firebase
    firebaseUID: {
      type: String,
      unique: true,
      sparse: true
    },

    fcmToken: {
      type: String,
      default: null
    },

    expoPushToken: {
      type: String,
      default: null
    },

    role: {
      type: String,
      default: "lender"
    },

    walletBalance: {
      type: Number,
      default: 0,
      min: 0
    },

    isPhoneVerified: {
      type: Boolean,
      default: false
    },

    // Local auth (optional)
    password: {
      type: String,
      select: false
    },

    tempPassword: {
      type: String,
      select: false
    },

    passwordChangedAt: Date,

    createdAt: {
      type: Date,
      default: Date.now
    },

    updatedAt: {
      type: Date,
      default: Date.now
    },

    isDeleted: {
      type: Boolean,
      default: false
    },

    deletedAt: {
      type: Date,
      default: null
    }
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

/**
 * PRE-SAVE HOOK
 * - Normalize phone
 * - Update timestamps
 * - Track password changes
 */
userSchema.pre("save", function (next) {
  if (this.phone) {
    const normalized = normalizePhone(this.phone);
    if (normalized) {
      this.phone = normalized;
    }
  }

  this.updatedAt = Date.now();

  if (this.isModified("password")) {
    this.passwordChangedAt = Date.now();
  }

  next();
});

// Indexes
userSchema.index({ phone: 1, firebaseUID: 1, role: 1 });

/**
 * PASSWORD CHECK
 */
userSchema.methods.correctPassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * JWT INVALIDATION CHECK
 */
userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10
    );
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

module.exports = mongoose.model("User", userSchema);
