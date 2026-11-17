// sms.worker.js
const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
});

const { Worker } = require("bullmq");
const bullRedis = require("./redis");
const initConfig = require("../config/loadConfig");
const connectDB = require("../config/db");
const SmsQueue = require("../models/SmsQueue");
const { sendSMSDirect } = require("../utils/sms");
const { initSmsEvents } = require("./sms.events");

/* ===============================
   INIT ONCE (IMPORTANT)
================================ */
const startWorker = async () => {
  console.log(" 🟡 Initializing global.config in worker...");
  await initConfig();
  console.log("✅ global.config initialized in worker");

  // Ensure DB is connected for the worker
  try {
    const mongoUri = global.config?.mongoUri || process.env.MONGO_URI;
    await connectDB(mongoUri);
  } catch (err) {
    console.error("❌ Worker DB connection error:", err.message);
  }

  // Initialize event logging
  initSmsEvents();

  console.log("✅ Background database connection ensured in worker");

  /* ===============================
     WORKER
  ================================ */
  const worker = new Worker(
    "sms-queue",
    async (job) => {
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("🆔 Job ID:", job.id);
      console.log(
        "🔁 Attempt:",
        job.attemptsMade + 1,
        "/",
        job.opts.attempts
      );
      console.log("📦 Job Data:", job.data);

      const { smsId, phoneNumber, message } = job.data;

      let smsRecord = null;

      if (smsId) {
        smsRecord = await SmsQueue.findById(smsId);
        if (!smsRecord) {
          throw new Error(`SmsQueue record not found for ID: ${smsId}`);
        }
        if (smsRecord.status === "Sent" || smsRecord.status === "Processing") {
          console.log(`⚠️ [SMS WORKER SKIPPED] SMS ID: ${smsRecord._id} is already ${smsRecord.status}`);
          return { success: true, skipped: true, status: smsRecord.status };
        }
        smsRecord.status = "Processing";
        await smsRecord.save();
      } else {
        // Fallback for legacy jobs
        console.warn(`⚠️ SMS Job without smsId. Creating new SmsQueue record for: ${phoneNumber}`);
        smsRecord = await SmsQueue.create({
          phoneNumber,
          message,
          status: "Pending",
        });
      }

      console.log(`📨 [SMS WORKER] Starting execution for SMS ID: ${smsRecord._id} | To: ${smsRecord.phoneNumber}`);
      
      const result = await sendSMSDirect(smsRecord);
      if (!result.success) {
        const msg = result.code || result.providerStatus || result.error || "SMS_FAILED";
        console.error(`❌ [SMS WORKER] SMS ID: ${smsRecord._id} | ${msg}`);
        throw new Error(msg);
      }
      console.log(`✅ [SMS WORKER SUCCESS] Delivered SMS ID: ${smsRecord._id} | To: ${smsRecord.phoneNumber}`);
      return {
        success: true,
        smsId: smsRecord._id,
        status: smsRecord.status,
        result,
      };
    },
    {
      connection: bullRedis,
      concurrency: 1, // recommended for SMS gateways
      stalledInterval: 300000, // 5 minutes instead of 30 seconds (reduces polling 10x)
      drainDelay: 10,           // reduce empty queue check frequency
      maxStalledCount: 2,
    }
  );

  worker.on("completed", (job) => console.log(`✅ [SMS WORKER] Job ${job.id} completed successfully`));
  worker.on("failed", (job, err) => console.error(`❌ [SMS WORKER] Job ${job.id} failed:`, err.message));
  worker.on("error", (err) => {
    // Suppress transient connection errors and limit errors from spamming logs
    if (
      err.code === 'ETIMEDOUT' || 
      err.code === 'ECONNRESET' || 
      err.message?.includes('ETIMEDOUT') || 
      err.message?.includes('ECONNRESET') ||
      err.message?.includes('max requests limit exceeded')
    ) {
      return;
    }
    console.error(`🚨 [SMS WORKER] Worker Error:`, err);
  });

  console.log("🚀 SMS Worker started");
};

module.exports = { startWorker };