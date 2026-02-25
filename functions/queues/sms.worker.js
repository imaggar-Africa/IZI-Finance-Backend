// sms.worker.js
const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
});

const { Worker } = require("bullmq");
const africastalking = require("africastalking");
const bullRedis = require("./redis");
const initConfig = require("../config/loadConfig");

require("./sms.events");

let smsClient;

/* ===============================
   INIT ONCE (IMPORTANT)
================================ */
const startWorker = async () => {
  console.log("🟡 Initializing global.config in worker...");
  await initConfig();
  console.log("✅ global.config initialized in worker");

  const AT_USERNAME = (global.config?.atUsername || "").trim();
  const AT_API_KEY = (global.config?.atApiKey || "").trim();
  const AT_SENDER_ID = (global.config?.atSenderId || "").trim();

  if (!AT_USERNAME || !AT_API_KEY) {
    throw new Error("AfricasTalking credentials missing");
  }

  const client = africastalking({
    username: AT_USERNAME,
    apiKey: AT_API_KEY,
  });

  smsClient = client.SMS;
  console.log("✅ AfricasTalking initialized in worker");

  /* ===============================
     WORKER
  ================================ */
  new Worker(
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

      const { phoneNumber, message } = job.data;

      console.log("📨 Sending SMS to:", phoneNumber);
      console.log("📝 Message:", message);

      const payload = {
        to: [phoneNumber],
        message,
      };

      // ✅ Sender ID only for non-sandbox
      if (AT_SENDER_ID && AT_USERNAME !== "sandbox") {
        payload.from = AT_SENDER_ID;
        console.log("🏷 Sender ID:", AT_SENDER_ID);
      }

      try {
        const result = await smsClient.send(payload);

        console.log("📩 Africa’s Talking FULL response:");
        console.log(JSON.stringify(result, null, 2));

        const recipient =
          result?.SMSMessageData?.Recipients?.[0];

        if (!recipient) {
          throw new Error("NO_RECIPIENT_RESPONSE");
        }

        if (recipient.status !== "Success") {
          throw new Error(`AT_STATUS_${recipient.status}`);
        }

        console.log("✅ SMS SENT SUCCESSFULLY");
        console.log("📱 Number:", recipient.number);
        console.log("🆔 Message ID:", recipient.messageId);
        console.log("💰 Cost:", recipient.cost);

        return {
          success: true,
          messageId: recipient.messageId,
          cost: recipient.cost,
        };
      } catch (err) {
        console.error("❌ SMS SEND FAILED");
        console.error("❗ Reason:", err.message);
        console.error(
          "🔁 Will retry:",
          job.attemptsMade + 1 < job.opts.attempts
        );
        throw err; // BullMQ retry
      }
    },
    {
      connection: bullRedis,
      concurrency: 1, // ✅ recommended for SMS gateways
    }
  );

  console.log("🚀 SMS Worker started");
};

/* ===============================
   START
================================ */
startWorker().catch((err) => {
  console.error("❌ Worker startup failed:", err.message);
  process.exit(1);
});