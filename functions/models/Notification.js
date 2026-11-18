const mongoose = require("mongoose");
const { sendPushToUser } = require("../utils/expoPush");

const NotificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: "userModel"  // dynamically decide model
  },
  userModel: {
    type: String,
    required: true,
    enum: ["User", "Customer","Agent"] // allowed models
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: {
    type: String,
    enum: [
      "deposit",
      "withdraw",
      "loan",
      "repayment",
      "loan_approved",
      "payment_due",
      "missed_payment",
      "general",
      "loan_rejected",
      "withdrawal_reject",
      "agent_withdrawal",
    ],
    default: "general"
  },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
   // 🔹 Soft delete fields
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },

});

// ⚡ Trigger Expo Push Notification on creation
NotificationSchema.post("save", async function (doc) {
  const meta = {
    notificationId: String(doc._id),
    userId: String(doc.userId),
    userModel: doc.userModel,
    type: doc.type,
    title: doc.title,
  };
  console.log("[NOTIFY] push_hook", meta);
  try {
    const result = await sendPushToUser(
      doc.userId,
      doc.userModel,
      doc.title,
      doc.message,
      { type: doc.type },
      `notification_hook:${doc.type}`
    );
    if (!result?.ok) {
      console.warn("[NOTIFY_PUSH] hook_skipped", {
        ...meta,
        reason: result?.reason || "unknown",
      });
    }
  } catch (err) {
    console.error("[NOTIFY_PUSH] hook_error", { ...meta, error: err.message });
  }
});

module.exports = mongoose.model("Notification", NotificationSchema);