const mongoose = require("mongoose");

const groupMemberSchema = new mongoose.Schema(
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

      internal_loan_amount: {
    type: Number
  },

  daily_repayment_amount: {
    type: Number
  },

  total_repaid: {
    type: Number,
    default: 0
  },

  remaining_balance: {
    type: Number
  },
      status: {
    type: String,
    enum: ["active", "delayed", "defaulted"],
    default: "active"
  },

  joined_at: {
    type: Date,
    default: Date.now
  }
  },
  { timestamps: true }
);

module.exports = mongoose.model("GroupMember", groupMemberSchema);
