// models/PaybillBalance.js
const mongoose = require("mongoose");

const paybillBalanceSchema = new mongoose.Schema({
  shortcode: {
    type: String,
    required: true,
    unique: true
  },
  availableBalance: {
    type: Number,
    required: true
  },
  lastUpdatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("PaybillBalance", paybillBalanceSchema);
