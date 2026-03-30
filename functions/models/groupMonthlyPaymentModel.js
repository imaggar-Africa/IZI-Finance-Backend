const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const paymentSchema = new mongoose.Schema({

  payment_id: {
    type: String,
    default: uuidv4
  },

  group_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Group"
  },

  expected_amount: {
    type: Number
  },

  actual_amount: {
    type: Number
  },

  shortfall: {
    type: Number
  },

  payment_date: {
    type: Date
  },

  status: {
    type: String,
    enum: ["pending", "paid", "shortfall"],
    default: "pending"
  },

  transaction_id: {
    type: String
  },

  reported_to_shofco: {
    type: Boolean,
    default: false
  }

}, { timestamps: true });

module.exports = mongoose.model("GroupMonthlyPayment", paymentSchema);