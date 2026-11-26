const mongoose = require("mongoose");

const SmsQueueSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Processing", "Sent", "Failed", "Waiting for Balance"],
      default: "Pending",
      index: true,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    lastAttemptAt: {
      type: Date,
    },
    errorDetails: {
      type: String,
    },
    job: { type: String, default: null },
    loanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Loan",
      default: null,
    },
    balanceKes: { type: Number, default: null },
    retryLogs: [
      {
        attempt: { type: Number, required: true },
        status: { type: String, required: true },
        error: { type: String },
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
    collection: "sms_queue",
  }
);

// Index to quickly fetch pending or waiting SMS messages
SmsQueueSchema.index({ status: 1, lastAttemptAt: 1 });

module.exports = mongoose.model("SmsQueue", SmsQueueSchema);
