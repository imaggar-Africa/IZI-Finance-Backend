const { QueueEvents } = require("bullmq");
const bullRedis = require("./redis");

let smsEvents = null;

function initSmsEvents() {
  if (smsEvents) return smsEvents;

  smsEvents = new QueueEvents("sms-queue", {
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
    console.error("❌ SMS Job failed | Job ID:", jobId, "| Reason:", failedReason);
  });

  smsEvents.on("ready", () => {
    console.log("🟢 SMS QueueEvents ready");
  });

  return smsEvents;
}

module.exports = { initSmsEvents };