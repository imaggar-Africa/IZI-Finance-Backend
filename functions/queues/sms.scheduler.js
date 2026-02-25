const { QueueScheduler } = require("bullmq");
const bullRedis = require("./redis");

const scheduler = new QueueScheduler("sms-queue", {
  connection: bullRedis,
});

scheduler.on("failed", (jobId, err) => {
  console.error("❌ Scheduler failed job:", jobId, err);
});

scheduler.on("ready", () => {
  console.log("🟢 SMS QueueScheduler ready");
});

module.exports = scheduler;