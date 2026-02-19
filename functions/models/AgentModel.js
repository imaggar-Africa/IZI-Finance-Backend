const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { normalizePhone } = require("../utils/normalizePhone");

const agentSchema = new mongoose.Schema(
  {
    lenderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", 
      required: true
    },

    name: {
      type: String,
      required: true,
      trim: true
    },

    phone: {
      type: String,
      required: true,
      unique: true
    },

    password: {
      type: String,
      required: true
    },

    /* ===============================
       REGISTRATION COMMISSION
    =============================== */
    registrationCommissionPercent: {
      type: Number,
      default: 0
    },

    /* ===============================
       REPAYMENT COMMISSION
    =============================== */
    repaymentCommissionType: {
      type: String,
      enum: ["percentage", "fixed"],
      default: "percentage"
    },

    repaymentCommissionPercent: {
      type: Number,
      default: 0
    },

    repaymentCommissionFixed: {
      type: Number,
      default: 0
    },

    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active"
    },

    totalEarnings: {
      type: Number,
      default: 0
    },

    walletBalance: {
      type: Number,
      default: 0
    },

    totalCustomers: {
      type: Number,
      default: 0
    },

    role: {
      type: String,
      default: "agent"
    }
  },
  { timestamps: true }
);

/* ===============================
   PRE SAVE
=============================== */
agentSchema.pre("save", async function (next) {
  if (this.phone) {
    const normalized = normalizePhone(this.phone);
    if (normalized) this.phone = normalized;
  }

  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

module.exports = mongoose.model("Agent", agentSchema);
