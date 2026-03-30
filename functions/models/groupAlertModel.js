const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const alertSchema = new mongoose.Schema({

  alert_id: {
    type: String,
    default: uuidv4
  },

  group_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Group"
  },

  member_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Customer"
  },

  alert_type: {
    type: String,
    enum: ["member_missed", "member_3day", "group_shortfall"]
  },

  message: {
    type: String
  },

  status: {
    type: String,
    enum: ["pending", "resolved", "escalated"],
    default: "pending"
  },

  sent_to: {
    type: String
  },

  resolved_at: {
    type: Date
  }

}, { timestamps: true });

module.exports = mongoose.model("GroupAlert", alertSchema);