const { QueueEvents } = require("bullmq");
const bullRedis = require("./redis");

const smsEvents = new QueueEvents("sms-queue", {
  connection: bullRedis,
});

smsEvents.on("waiting", ({ jobId }) => {
  console.log("⏳ SMS Job waiting | Job ID:", jobId);
});

smsEvents.on("active", ({ jobId }) => {
  console.log("⚡ SMS Job active | Job ID:", jobId);
});

smsEvents.on("completed", ({ jobId }) => {
  console.log("✅ SMS Job completed | Job ID:", jobId);
});

smsEvents.on("failed", ({ jobId, failedReason, prev }) => {
  console.error("❌ SMS Job failed");
  console.error("🆔 Job ID:", jobId);
  console.error("📌 Reason:", failedReason);
  console.error("↩️ Previous state:", prev);
});

smsEvents.on("ready", () => {
  console.log("🟢 SMS QueueEvents ready");
});

module.exports = smsEvents;