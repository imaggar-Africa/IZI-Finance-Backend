const mongoose = require("mongoose");

const groupLoanRequestSchema = new mongoose.Schema(
  {
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: true
    },
    borrowerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true
    },
    requestedAmount: {
      type: Number,
      required: true
    },
    interestAmount: {
      type: Number,
      required: true
    },
    totalRepayment: {
      type: Number,
      required: true
    },
    durationMonths: {
      type: Number,
      required: true
    },
    dailyRepayment: {
      type: Number,
      required: true
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending"
    },
    lenderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("GroupLoanRequest", groupLoanRequestSchema);
