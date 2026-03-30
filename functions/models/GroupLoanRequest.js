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
    requestedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    interest_rate: {
      type: Number,
      required: true
    },
    total_repayment: {
      type: Number,
      required: true
    },
    daily_repayment: {
      type: Number,
      required: true
    },
    status: {
      type: String,
      enum: ["pending", "processing", "approved", "rejected", "disbursed"],
      default: "pending"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("GroupLoanRequest", groupLoanRequestSchema);
