const africastalking = require("africastalking");
const { normalizePhone } = require("./normalizePhone");
const smsQueue = require("../queues/sms.queue");
const SmsQueue = require("../models/SmsQueue");

// ------------------------------
// AfricasTalking SMS client
// ------------------------------
let smsClient = null;
let isSMSInitialized = false;

// Lazy initialize SMS client using global.config or process.env
const initSMS = () => {
  if (isSMSInitialized && smsClient) return;

  const AT_USERNAME = (global.config?.atUsername || process.env.AT_USERNAME || "").trim();
  const AT_API_KEY = (global.config?.atApiKey || process.env.AT_API_KEY || "").trim();

  if (!AT_USERNAME || !AT_API_KEY) {
    console.warn("⚠️ AfricasTalking credentials missing; SMS client disabled.");
    return;
  }

  try {
    const client = africastalking({
      apiKey: AT_API_KEY,
      username: AT_USERNAME,
    });

    smsClient = client.SMS;
    isSMSInitialized = true;
    console.log("✅ AfricasTalking SMS client initialized");
  } catch (err) {
    console.error("❌ Failed to initialize AfricasTalking:", err);
  }
};

/**
 * Determine if an error is due to insufficient balance on the SMS provider.
 */
const isInsufficientBalanceError = (err) => {
  if (!err) return false;
  const errMsg = (err.message || String(err)).toLowerCase();
  return (
    errMsg.includes("balance") ||
    errMsg.includes("insufficient") ||
    errMsg.includes("credit") ||
    errMsg.includes("funds")
  );
};

// ------------------------------
// Send SMS directly to provider
// ------------------------------
const sendSMSDirect = async (smsRecord) => {
  initSMS();

  if (!smsClient) {
    throw new Error("SMS client is not initialized due to missing credentials.");
  }

  const AT_USERNAME = (global.config?.atUsername || process.env.AT_USERNAME || "").trim();
  const AT_SENDER_ID = (global.config?.atSenderId || process.env.AT_SENDER_ID || "").trim();

  const payload = {
    to: [smsRecord.phoneNumber],
    message: smsRecord.message,
  };

  if (AT_SENDER_ID && AT_USERNAME !== "sandbox") {
    payload.from = AT_SENDER_ID;
  }

  const attemptNumber = smsRecord.retryCount + 1;
  smsRecord.lastAttemptAt = new Date();

  try {
    const result = await smsClient.send(payload);
    console.log(`📩 Africa’s Talking FULL response for SMS ID: ${smsRecord._id}`);
    console.log(JSON.stringify(result, null, 2));

    const recipient = result?.SMSMessageData?.Recipients?.[0];

    if (!recipient) {
      throw new Error("NO_RECIPIENT_RESPONSE");
    }

    if (recipient.status !== "Success") {
      // Check if recipient status indicates insufficient balance
      if (recipient.status === "InsufficientBalance" || recipient.status.toLowerCase().includes("balance")) {
        throw new Error("InsufficientBalance");
      }
      throw new Error(`AT_STATUS_${recipient.status}`);
    }

    // Success
    smsRecord.status = "Sent";
    smsRecord.errorDetails = null;
    smsRecord.retryLogs.push({
      attempt: attemptNumber,
      status: "Sent",
      timestamp: new Date(),
    });

    await smsRecord.save();
    console.log(`✅ SMS SENT SUCCESSFULLY | ID: ${smsRecord._id} | To: ${recipient.number}`);
    return { success: true, recipient };
  } catch (err) {
    const isBalanceError = isInsufficientBalanceError(err);
    const newStatus = isBalanceError ? "Waiting for Balance" : "Pending";

    smsRecord.errorDetails = err.message;
    
    if (isBalanceError) {
      smsRecord.status = "Waiting for Balance";
      console.warn(`⚠️ SMS INSUBALANCE | ID: ${smsRecord._id} | Status: Waiting for Balance`);
    } else {
      smsRecord.retryCount = attemptNumber;
      if (smsRecord.retryCount >= 5) {
        smsRecord.status = "Failed";
        console.error(`❌ SMS MAX RETRIES REACHED | ID: ${smsRecord._id} | Status: Failed`);
      } else {
        smsRecord.status = "Pending";
        console.warn(`⚠️ SMS ATTEMPT ${attemptNumber} FAILED | ID: ${smsRecord._id} | Status: Pending | Error: ${err.message}`);
      }
    }

    smsRecord.retryLogs.push({
      attempt: attemptNumber,
      status: smsRecord.status,
      error: err.message,
      timestamp: new Date(),
    });

    await smsRecord.save();
    throw err;
  }
};

// ------------------------------
// Send SMS function (called by application)
// ------------------------------
const sendSMS = async (phoneNumber, message) => {
  try {
    const normalizedPhone = normalizePhone(phoneNumber);

    if (!normalizedPhone) {
      console.warn("⚠️ SMS skipped. Invalid phone:", phoneNumber);
      return { success: false, message: "Invalid phone number" };
    }

    // Deduplication check: check if an identical SMS is already Pending or Sent recently (within last 2 minutes)
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const existing = await SmsQueue.findOne({
      phoneNumber: normalizedPhone,
      message,
      status: { $in: ["Pending", "Processing", "Sent"] },
      createdAt: { $gte: twoMinutesAgo },
    });

    if (existing) {
      console.log(`⚠️ [SMS DUP SKIPPED] Duplicate SMS within 2 minutes for ${normalizedPhone}`);
      return { success: true, message: "Duplicate SMS skipped", smsId: existing._id };
    }

    // 1. Store SMS in database
    const smsRecord = await SmsQueue.create({
      phoneNumber: normalizedPhone,
      message,
      status: "Pending",
    });

    console.log(`📥 [SMS STORED] | ID: ${smsRecord._id} | To: ${normalizedPhone}`);

    // 2. Queue job in BullMQ exclusively
    try {
      const job = await smsQueue.add("send-sms", {
        smsId: smsRecord._id,
        phoneNumber: normalizedPhone,
        message,
      });
      console.log(`📥 [SMS QUEUED] | JobID: ${job.id} | ID: ${smsRecord._id}`);
    } catch (queueErr) {
      console.error("⚠️ Failed to enqueue SMS to BullMQ:", queueErr.message);
    }

    return {
      success: true,
      message: "SMS queued successfully",
      smsId: smsRecord._id,
    };
  } catch (error) {
    console.error("❌ Error queueing SMS:", error.message);
    return { success: false, error: error.message };
  }
};

// ------------------------------
// Database retry scan handler (enqueues to BullMQ instead of direct sending)
// ------------------------------
const processSmsQueueRetry = async () => {
  console.log("[SMS_RETRY_CRON] Starting database queue scan...");
  try {
    // Only pick up Pending messages older than 5 minutes that aren't being processed or waiting on balance
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const smsToRetry = await SmsQueue.find({
      status: "Pending",
      createdAt: { $lt: fiveMinutesAgo },
      retryCount: { $lt: 5 },
    });

    console.log(`[SMS_RETRY_CRON] 🔍 Found ${smsToRetry.length} stale pending SMS records to re-enqueue.`);

    let enqueuedCount = 0;

    for (const sms of smsToRetry) {
      try {
        await smsQueue.add("send-sms", {
          smsId: sms._id,
          phoneNumber: sms.phoneNumber,
          message: sms.message,
        });
        enqueuedCount++;
        console.log(`[SMS_RETRY_CRON] 🔁 Re-enqueued SMS ID: ${sms._id} to BullMQ`);
      } catch (err) {
        console.error(`[SMS_RETRY_CRON] ❌ Failed to re-enqueue SMS ID: ${sms._id} | Error: ${err.message}`);
      }
    }

    console.log(`[SMS_RETRY_CRON] Scan completed. Processed: ${smsToRetry.length}, Re-enqueued: ${enqueuedCount}`);

    return {
      processed: smsToRetry.length,
      successCount: enqueuedCount,
      failedCount: smsToRetry.length - enqueuedCount,
    };
  } catch (error) {
    console.error("[SMS_RETRY_CRON] ❌ Error processing SMS queue retries:", error.message);
    throw error;
  }
};

module.exports = {
  sendSMS,
  sendSMSDirect,
  processSmsQueueRetry,
  isInsufficientBalanceError,
};
