const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    userRole: {
      type: String,
      required: true
    },
    reportType: {
      type: String,
      required: true
    },
    filtersUsed: {
      type: Object,
      default: {}
    },
    endpoint: String,
    ipAddress: String
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuditLog", auditLogSchema);
