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
  console.log(`🔔 Notification Hook fired for [${doc.title}] - User: ${doc.userId} (${doc.userModel})`);
  try {
    const result = await sendPushToUser(
      doc.userId,
      doc.userModel,
      doc.title,
      doc.message,
      { type: doc.type }
    );
    if (!result) {
      console.warn(`⚠️ No Push Token found for User: ${doc.userId}. Push notification skipped.`);
    } else {
      console.log(`✅ Push Sent Successfully for [${doc.title}]`);
    }
  } catch (err) {
    console.error("❌ Push Error in Notification Model Hook:", err.message);
  }
});

module.exports = mongoose.model("Notification", NotificationSchema);