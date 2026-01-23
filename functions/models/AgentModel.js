const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { normalizePhone } = require("../utils/normalizePhone");

const agentSchema = new mongoose.Schema(
  {
    lenderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lender",
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
      // ❌ removed Kenya-only regex
      // Validation is handled by middleware + normalization
    },

    password: {
      type: String,
      required: true
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

    commissionEarned: {
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
    },

    customers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Customer"
      }
    ]
  },
  { timestamps: true }
);

/**
 * PRE-SAVE HOOK
 * - Normalize phone
 * - Hash password if changed
 */
agentSchema.pre("save", async function (next) {
  // Normalize phone
  if (this.phone) {
    const normalized = normalizePhone(this.phone);
    if (normalized) {
      this.phone = normalized;
    }
  }

  // Hash password if modified
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

/**
 * PASSWORD VERIFICATION
 */
agentSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

/**
 * ADD CUSTOMER TO AGENT
 */
agentSchema.methods.addCustomer = async function (customerId) {
  if (!this.customers.includes(customerId)) {
    this.customers.push(customerId);
    this.totalCustomers += 1;
    await this.save();
  }
};

module.exports = mongoose.model("Agent", agentSchema);
