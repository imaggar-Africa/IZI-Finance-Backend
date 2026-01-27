const mongoose = require("mongoose");
const { normalizePhone } = require("../utils/normalizePhone");

const customerSchema = new mongoose.Schema({
  registeredBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: "registeredByModel"
  },
  registeredByModel: {
    type: String,
    required: true,
    enum: ["User", "Agent"]
  },
  assignedAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Agent"
  },

  fullName: {
    type: String,
    required: true
  },

  phone: {
    type: String,
    required: true,
    unique: true
  },

   email: {
    type: String,
    required: true,
    unique: true
  },

  idNumber: {
    type: String,
    required: true,
    unique: true
  },

  livePhoto: {
    type: String,
    required: true
  },

  frontID: {
    type: String,
    required: true
  },

  backID: {
    type: String,
    required: true
  },

  isVerified: {
    type: Boolean,
    default: false
  },

  preferences: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  savingsBalance: {
    type: Number,
    default: 0,
    min: 0
  },

  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Agent"
  },

  // ---------------- PROFILE ----------------
  dateOfBirth: { type: Date },
  gender: { type: String, enum: ["Male", "Female", "Other"] },
  maritalStatus: {
    type: String,
    enum: ["Single", "Married", "Widowed", "Divorced"]
  },

  altPhoneNumber: { type: String },

  physicalAddress: { type: String },

  gpsLocation: {
    lat: { type: Number },
    lng: { type: Number }
  },

  occupation: { type: String },

  monthlyIncomeRange: {
    type: String,
    enum: ["<KES 5,000", "5k–10k", "10k–20k", "20k+"]
  },

  nextOfKinName: { type: String },
  nextOfKinPhone: { type: String },

  preferredMobileMoney: {
    type: String,
    enum: ["M-Pesa", "Airtel", "Other"]
  },

  savingsGoal: { type: String },
  loanConsent: { type: Boolean, default: false },

  kraPin: { type: String },
  agreementAcceptance: { type: Boolean, default: false },

  // ---------------- LOCATION ----------------
  market: {
    type: String,
    trim: true
  },

  town: {
    type: String,
    trim: true
  },

  // ---------------- STATUS ----------------
  status: {
    type: String,
    enum: ["Draft", "Active", "Inactive"],
    default: "Draft"
  },

  referredByBorrowerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Customer",
    default: null
  },

  referralSource: {
    type: String,
    enum: ["existing_borrower", "advertisement", "direct"],
    required: true
  },

  accountId: {
  type: String,
  unique: true,
  index: true,
  required: true
},

  // ---------------- META ----------------
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
});

/**
 * PRE-SAVE HOOK
 * - Normalizes all phone numbers
 * - Updates updatedAt timestamp
 */
customerSchema.pre("save", function (next) {
  if (this.phone) {
    const normalized = normalizePhone(this.phone);
    if (normalized) this.phone = normalized;
  }

  if (this.altPhoneNumber) {
    const normalizedAlt = normalizePhone(this.altPhoneNumber);
    if (normalizedAlt) this.altPhoneNumber = normalizedAlt;
  }

  if (this.nextOfKinPhone) {
    const normalizedKin = normalizePhone(this.nextOfKinPhone);
    if (normalizedKin) this.nextOfKinPhone = normalizedKin;
  }

  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("Customer", customerSchema);
