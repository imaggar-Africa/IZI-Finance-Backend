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

  const pushRetryLog = (entry) => {
    if (!smsRecord.retryLogs) smsRecord.retryLogs = [];
    smsRecord.retryLogs.push(entry);
  };

  try {
    const result = await smsClient.send(payload);
    const messageData = result?.SMSMessageData || {};
    const recipient = messageData.Recipients?.[0];

    if (!recipient) {
      const errDetail = messageData.Message || "NO_RECIPIENT_RESPONSE";
      smsRecord.errorDetails = errDetail;
      smsRecord.status = "Pending";
      smsRecord.retryCount = attemptNumber;
      pushRetryLog({
        attempt: attemptNumber,
        status: "Pending",
        error: errDetail,
        timestamp: new Date(),
      });
      await smsRecord.save();
      console.warn("[SMS_AT]", {
        smsId: String(smsRecord._id),
        success: false,
        code: "NO_RECIPIENT_RESPONSE",
        providerMessage: errDetail,
      });
      return {
        success: false,
        code: "NO_RECIPIENT_RESPONSE",
        smsId: smsRecord._id,
        providerMessage: errDetail,
      };
    }

    const providerStatus = recipient.status;
    const statusCode = recipient.statusCode;
    const providerMessage = messageData.Message;

    if (providerStatus !== "Success") {
      const isBalance =
        providerStatus === "InsufficientBalance" ||
        String(providerStatus).toLowerCase().includes("balance");

      smsRecord.errorDetails = JSON.stringify({
        providerStatus,
        statusCode,
        providerMessage,
        number: recipient.number,
      });

      if (isBalance) {
        smsRecord.status = "Waiting for Balance";
        pushRetryLog({
          attempt: attemptNumber,
          status: "Waiting for Balance",
          error: providerStatus,
          timestamp: new Date(),
        });
        await smsRecord.save();
        console.warn("[SMS_AT]", {
          smsId: String(smsRecord._id),
          success: false,
          code: "INSUFFICIENT_BALANCE",
          providerStatus,
          statusCode,
          providerMessage,
          phone: recipient.number,
        });
        return {
          success: false,
          code: "INSUFFICIENT_BALANCE",
          smsId: smsRecord._id,
          dbStatus: "Waiting for Balance",
          providerStatus,
          statusCode,
          providerMessage,
          phone: recipient.number,
        };
      }

      smsRecord.retryCount = attemptNumber;
      smsRecord.status = smsRecord.retryCount >= 5 ? "Failed" : "Pending";
      pushRetryLog({
        attempt: attemptNumber,
        status: smsRecord.status,
        error: providerStatus,
        timestamp: new Date(),
      });
      await smsRecord.save();
      console.warn("[SMS_AT]", {
        smsId: String(smsRecord._id),
        success: false,
        code: "PROVIDER_REJECTED",
        providerStatus,
        statusCode,
        providerMessage,
        phone: recipient.number,
        dbStatus: smsRecord.status,
      });
      return {
        success: false,
        code: "PROVIDER_REJECTED",
        smsId: smsRecord._id,
        dbStatus: smsRecord.status,
        providerStatus,
        statusCode,
        providerMessage,
        phone: recipient.number,
      };
    }

    smsRecord.status = "Sent";
    smsRecord.errorDetails = null;
    pushRetryLog({
      attempt: attemptNumber,
      status: "Sent",
      timestamp: new Date(),
    });

    await smsRecord.save();
    console.log("[SMS_AT]", {
      smsId: String(smsRecord._id),
      success: true,
      phone: recipient.number,
      cost: recipient.cost,
      messageId: recipient.messageId,
    });
    return {
      success: true,
      smsId: smsRecord._id,
      recipient,
      providerMessage,
    };
  } catch (err) {
    const isBalanceError = isInsufficientBalanceError(err);
    smsRecord.errorDetails = err.message;

    if (isBalanceError) {
      smsRecord.status = "Waiting for Balance";
    } else {
      smsRecord.retryCount = attemptNumber;
      smsRecord.status = smsRecord.retryCount >= 5 ? "Failed" : "Pending";
    }

    pushRetryLog({
      attempt: attemptNumber,
      status: smsRecord.status,
      error: err.message,
      timestamp: new Date(),
    });

    await smsRecord.save();
    console.error("[SMS_AT]", {
      smsId: String(smsRecord._id),
      success: false,
      code: isBalanceError ? "INSUFFICIENT_BALANCE" : "SEND_ERROR",
      error: err.message,
      dbStatus: smsRecord.status,
    });
    return {
      success: false,
      code: isBalanceError ? "INSUFFICIENT_BALANCE" : "SEND_ERROR",
      smsId: smsRecord._id,
      dbStatus: smsRecord.status,
      error: err.message,
    };
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

// ------------------------------
// Drain Pending SMS on serverless (Vercel cron — no long-lived BullMQ worker)
// ------------------------------
async function drainSmsQueueForServerless(options = {}) {
  const limit = options.limit ?? parseInt(process.env.CRON_SMS_DRAIN_LIMIT || "25", 10);
  const maxMs = options.maxMs ?? parseInt(process.env.CRON_SMS_DRAIN_MAX_MS || "50000", 10);
  const start = Date.now();

  console.log(`[SMS_DRAIN] Starting (limit=${limit}, maxMs=${maxMs})`);

  const staleProcessingCutoff = new Date(Date.now() - 10 * 60 * 1000);
  await SmsQueue.updateMany(
    { status: "Processing", updatedAt: { $lt: staleProcessingCutoff } },
    { $set: { status: "Pending" } }
  );

  const pending = await SmsQueue.find({ status: "Pending" })
    .sort({ createdAt: 1 })
    .limit(limit);

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let waitingForBalance = 0;
  const errors = [];

  for (const sms of pending) {
    if (Date.now() - start > maxMs) {
      console.warn("[SMS_DRAIN] Stopped: time budget exceeded");
      break;
    }

    const claimed = await SmsQueue.findOneAndUpdate(
      { _id: sms._id, status: "Pending" },
      { $set: { status: "Processing", lastAttemptAt: new Date() } },
      { new: true }
    );

    if (!claimed) {
      skipped++;
      continue;
    }

    const outcome = await sendSMSDirect(claimed);
    if (outcome.success) {
      sent++;
      continue;
    }
    const errEntry = {
      smsId: String(claimed._id),
      phone: claimed.phoneNumber,
      code: outcome.code,
      providerStatus: outcome.providerStatus,
      statusCode: outcome.statusCode,
      providerMessage: outcome.providerMessage,
      dbStatus: outcome.dbStatus,
    };
    if (outcome.code === "INSUFFICIENT_BALANCE") {
      waitingForBalance++;
      errors.push(errEntry);
      console.warn(
        "[SMS_DRAIN] Stopping: Africa's Talking INSUFFICIENT_BALANCE (top up SMS wallet)"
      );
      break;
    }
    failed++;
    errors.push(errEntry);
    if (errors.length <= 5) {
      console.warn("[SMS_DRAIN] provider error", errEntry);
    }
  }

  const summary = {
    sent,
    failed,
    waitingForBalance,
    skipped,
    examined: pending.length,
    ...(errors.length ? { errors: errors.slice(0, 10) } : {}),
  };
  console.log(`[SMS_DRAIN] Done in ${Date.now() - start}ms`, summary);
  return summary;
}

module.exports = {
  sendSMS,
  sendSMSDirect,
  processSmsQueueRetry,
  drainSmsQueueForServerless,
  isInsufficientBalanceError,
};
