const mongoose = require("mongoose");

const groupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: String,

    lenderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },

    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Agent"
    },

    leaderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer"
    },

    creditLimit: { type: Number, default: 0 },

    totalContribution: { type: Number, default: 0 },
    totalOwed: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Group", groupSchema);
