const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onInit } = require("firebase-functions/v2/core");
const { defineSecret } = require("firebase-functions/params");

const { app, initializeApp } = require("./app");

// Load dotenv only in emulator / local
// if (process.env.FUNCTIONS_EMULATOR) {
//   require("dotenv").config();
// }

/*************************************************
 * SECRETS
 *************************************************/

// Africa Talking
const atUsername = defineSecret("AT_USERNAME");
const atApiKey = defineSecret("AT_API_KEY");
const atSenderId = defineSecret("AT_SENDER_ID");

// Database
const mongoUri = defineSecret("MONGO_URI");
const redisUrl = defineSecret("UPSTASH_REDIS_REST_URL");
const redisToken = defineSecret("UPSTASH_REDIS_REST_TOKEN");

// JWT
const jwtAccessSecret = defineSecret("JWT_ACCESS_SECRET");
const jwtRefreshSecret = defineSecret("JWT_REFRESH_SECRET");
const jwtAccessTtl = defineSecret("JWT_ACCESS_TTL");
const jwtRefreshTtl = defineSecret("JWT_REFRESH_TTL");

// Firebase Admin
const clientEmail = defineSecret("CLIENT_EMAIL");
const fbPrivateKey = defineSecret("FB_PRIVATE_KEY");
const projectId = defineSecret("PROJECT_ID");
const storageBucket = defineSecret("STORAGE_BUCKET");

// MPESA STK
const mpesaEnv = defineSecret("MPESA_ENV");
const mpesaConsumerKey = defineSecret("MPESA_CONSUMER_KEY");
const mpesaConsumerSecret = defineSecret("MPESA_CONSUMER_SECRET");
const mpesaShortcode = defineSecret("MPESA_SHORTCODE");
const mpesaPasskey = defineSecret("MPESA_PASSKEY");
const mpesaStkCallback = defineSecret("MPESA_STK_CALLBACK_URL");

// MPESA B2C
const mpesaB2cShortcode = defineSecret("MPESA_B2C_SHORTCODE");
const mpesaB2cInitiator = defineSecret("MPESA_B2C_INITIATOR");
const mpesaB2cCredential = defineSecret("MPESA_B2C_SECURITY_CREDENTIAL");
const mpesaB2cResultUrl = defineSecret("MPESA_B2C_RESULT_URL");
const mpesaB2cTimeoutUrl = defineSecret("MPESA_B2C_TIMEOUT_URL");

// MPESA REVERSAL (URL derived from MPESA_ENV in mpesa.js)
const mpesaReversalResult = defineSecret("MPESA_REVERSAL_RESULT_URL");
const mpesaReversalTimeout = defineSecret("MPESA_REVERSAL_TIMEOUT_URL");

// MPESA C2B
const mpesaC2bConfirmUrl = defineSecret("MPESA_CONFIRM_URL");
const mpesaC2bValidateUrl = defineSecret("MPESA_VALIDATE_URL");

// MPESA ACCOUNT BALANCE
const mpesaAccountBalanceResultUrl = defineSecret(
  "MPESA_ACCOUNT_BALANCE_RESULT_URL"
);

/*************************************************
 * GLOBAL FUNCTION OPTIONS
 *************************************************/

setGlobalOptions({
  region: "us-central1",
  timeoutSeconds: 700,
  memory: "2GiB",
  secrets: [
    atUsername, atApiKey, atSenderId,
    mongoUri, redisUrl, redisToken,
    jwtAccessSecret, jwtRefreshSecret, jwtAccessTtl, jwtRefreshTtl,
    clientEmail, fbPrivateKey, projectId, storageBucket,

    mpesaEnv, mpesaConsumerKey, mpesaConsumerSecret,
    mpesaShortcode, mpesaPasskey, mpesaStkCallback,

    mpesaB2cShortcode, mpesaB2cInitiator, mpesaB2cCredential,
    mpesaB2cResultUrl, mpesaB2cTimeoutUrl,

    mpesaReversalResult, mpesaReversalTimeout,

    mpesaC2bConfirmUrl, mpesaC2bValidateUrl,

    mpesaAccountBalanceResultUrl
  ],
});

/*************************************************
 * LOAD SECRETS (NO DB CONNECTION HERE)
 *************************************************/

const getSecretValue = (secret) => {
  try {
    return secret ? secret.value() : "";
  } catch (err) {
    return "";
  }
};

onInit(async () => {
  console.log("🔥 Loading secrets...");

  const clean = (val) => {
    if (!val) return "";
    let str = String(val).trim();
    if (str.startsWith('"') && str.endsWith('"')) {
      str = str.slice(1, -1).trim();
    }
    if (str.startsWith("'") && str.endsWith("'")) {
      str = str.slice(1, -1).trim();
    }
    return str;
  };

  try {
    const config = {
      mongoUri: clean(getSecretValue(mongoUri)),
      redisUrl: clean(getSecretValue(redisUrl)),
      redisToken: clean(getSecretValue(redisToken)),

      jwtAccessSecret: clean(getSecretValue(jwtAccessSecret)),
      jwtRefreshSecret: clean(getSecretValue(jwtRefreshSecret)),
      jwtAccessTtl: clean(getSecretValue(jwtAccessTtl)),
      jwtRefreshTtl: clean(getSecretValue(jwtRefreshTtl)),

      atUsername: clean(getSecretValue(atUsername)),
      atApiKey: clean(getSecretValue(atApiKey)),
      atSenderId: clean(getSecretValue(atSenderId)),

      mpesaEnv: clean(getSecretValue(mpesaEnv) || "sandbox").toLowerCase(),
      mpesaConsumerKey: clean(getSecretValue(mpesaConsumerKey)),
      mpesaConsumerSecret: clean(getSecretValue(mpesaConsumerSecret)),
      mpesaShortcode: clean(getSecretValue(mpesaShortcode)),
      mpesaPasskey: clean(getSecretValue(mpesaPasskey)),
      mpesaStkCallback: clean(getSecretValue(mpesaStkCallback)),

      mpesaB2cShortcode: clean(getSecretValue(mpesaB2cShortcode)),
      mpesaB2cInitiator: clean(getSecretValue(mpesaB2cInitiator)),
      mpesaB2cCredential: clean(getSecretValue(mpesaB2cCredential)),
      mpesaB2cResultUrl: clean(getSecretValue(mpesaB2cResultUrl)),
      mpesaB2cTimeoutUrl: clean(getSecretValue(mpesaB2cTimeoutUrl)),

      mpesaReversalResult: clean(getSecretValue(mpesaReversalResult)),
      mpesaReversalTimeout: clean(getSecretValue(mpesaReversalTimeout)),

      mpesaC2bConfirmUrl: clean(getSecretValue(mpesaC2bConfirmUrl)),
      mpesaC2bValidateUrl: clean(getSecretValue(mpesaC2bValidateUrl)),

      mpesaAccountBalanceResultUrl: clean(getSecretValue(mpesaAccountBalanceResultUrl)),

      clientEmail: clean(getSecretValue(clientEmail)),
      fbPrivateKey: clean(getSecretValue(fbPrivateKey)),
      projectId: clean(getSecretValue(projectId)),
      storageBucket: clean(getSecretValue(storageBucket)),
    };

    global.config = config;

    console.log("✅ Secrets loaded");

    const isRuntime = process.env.K_SERVICE || process.env.FUNCTIONS_EMULATOR === "true";

    if (isRuntime) {
      const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
      const serviceName = (process.env.K_SERVICE || "api").toLowerCase();
      const isMainApiService = serviceName === "api" || serviceName === "apiv2" || serviceName.includes("api");

      // 🚀 Start background queue worker in Cloud Run / Firebase deployment (skipped only in local emulator)
      if (!isEmulator && isMainApiService) {
        try {
          const { startWorker } = require("./queues/sms.worker");
          startWorker().catch(err => console.error("❌ Worker failed to start:", err));
          console.log("🚀 SMS Worker started successfully for Cloud container:", serviceName);
        } catch (err) {
          console.warn("⚠️ Could not load SMS worker:", err.message);
        }
      } else {
        console.log("ℹ️ Skipping SMS worker startup (running locally on emulator or non-API container)");
      }

      console.log("🚀 Initializing database and services...");
      await initializeApp(config);
      console.log("✅ App initialization complete");
    } else {
      console.log("📝 Skipping DB/Worker initialization during function discovery/deployment analysis");
    }
  } catch (err) {
    console.error("❌ Container startup error in onInit:", err);
  }
});


// ----- Export HTTPS API -----
exports.api = onRequest(
  {
    maxBodySize: "20mb",
    timeoutSeconds: 540,
    cors: true,
    rawBody: true,

    // Cloud Run / Firebase Function instances
    minInstances: 0,
    maxInstances: 10,
  },
  app
);

/*************************************************
//  * EXPORT API
//  *************************************************/

exports.apiV2 = onRequest(
  {
    maxBodySize: "20mb",
    timeoutSeconds: 540,
    cors: true,
    rawBody: true,
    minInstances: 0,
    maxInstances: 10,
  },
  app
);

/*************************************************
 * 🕒 SCHEDULED TASKS (CRON JOBS)
 *************************************************/

async function ensureGlobalConfig() {
  if (!global.config) {
    console.log("🟡 Initializing global.config from secrets...");
    const clean = (val) => (val ? String(val).trim() : "");
    global.config = {
      mongoUri: clean(getSecretValue(mongoUri)),
      redisUrl: clean(getSecretValue(redisUrl)),
      redisToken: clean(getSecretValue(redisToken)),

      jwtAccessSecret: clean(getSecretValue(jwtAccessSecret)),
      jwtRefreshSecret: clean(getSecretValue(jwtRefreshSecret)),
      jwtAccessTtl: clean(getSecretValue(jwtAccessTtl)),
      jwtRefreshTtl: clean(getSecretValue(jwtRefreshTtl)),

      atUsername: clean(getSecretValue(atUsername)),
      atApiKey: clean(getSecretValue(atApiKey)),
      atSenderId: clean(getSecretValue(atSenderId)),

      mpesaEnv: clean(getSecretValue(mpesaEnv) || "sandbox").toLowerCase(),
      mpesaConsumerKey: clean(getSecretValue(mpesaConsumerKey)),
      mpesaConsumerSecret: clean(getSecretValue(mpesaConsumerSecret)),
      mpesaShortcode: clean(getSecretValue(mpesaShortcode)),
      mpesaPasskey: clean(getSecretValue(mpesaPasskey)),
      mpesaStkCallback: clean(getSecretValue(mpesaStkCallback)),

      mpesaB2cShortcode: clean(getSecretValue(mpesaB2cShortcode)),
      mpesaB2cInitiator: clean(getSecretValue(mpesaB2cInitiator)),
      mpesaB2cCredential: clean(getSecretValue(mpesaB2cCredential)),
      mpesaB2cResultUrl: clean(getSecretValue(mpesaB2cResultUrl)),
      mpesaB2cTimeoutUrl: clean(getSecretValue(mpesaB2cTimeoutUrl)),

      mpesaReversalResult: clean(getSecretValue(mpesaReversalResult)),
      mpesaReversalTimeout: clean(getSecretValue(mpesaReversalTimeout)),

      mpesaC2bConfirmUrl: clean(getSecretValue(mpesaC2bConfirmUrl)),
      mpesaC2bValidateUrl: clean(getSecretValue(mpesaC2bValidateUrl)),

      mpesaAccountBalanceResultUrl: clean(getSecretValue(mpesaAccountBalanceResultUrl)),

      clientEmail: clean(getSecretValue(clientEmail)),
      fbPrivateKey: clean(getSecretValue(fbPrivateKey)),
      projectId: clean(getSecretValue(projectId)),
      storageBucket: clean(getSecretValue(storageBucket)),
    };
    await initializeApp(global.config);
  }
}

const { checkLoansAndSendReminders, runScoreRecovery } = require("./utils/cron/loanCron");

exports.dailyGroupHealthCheck = onSchedule(
  {
    schedule: "0 0 1 * *", // 12:00 AM on the 1st of the month
    timeZone: "Africa/Nairobi",
    memory: "1GiB",
    timeoutSeconds: 540,
    region: "us-central1"
  },
  async (event) => {
    const startTime = Date.now();
    try {
      console.log(`🕒 [DAILY_GROUP_HEALTH_CHECK] Started at ${new Date().toISOString()}`);
      await ensureGlobalConfig();
      console.log("[DAILY_GROUP_HEALTH_CHECK] Global config & database initialized. Running checkGroupHealth...");

      const { checkGroupHealth } = require("./controllers/groupAlertController");
      
      const mockReq = {};
      const mockRes = {
        status: (code) => ({
          json: (data) => console.log(`[DAILY_GROUP_HEALTH_CHECK] Controller Result (${code}):`, JSON.stringify(data))
        })
      };

      await checkGroupHealth(mockReq, mockRes);
      const duration = Date.now() - startTime;
      console.log(`✅ [DAILY_GROUP_HEALTH_CHECK] Completed successfully in ${duration}ms.`);
    } catch (error) {
      console.error(`❌ [DAILY_GROUP_HEALTH_CHECK] Failed after ${Date.now() - startTime}ms:`, error);
      throw error;
    }
  }
);

exports.monthlyGroupRepaymentProcess = onSchedule(
  {
    schedule: "0 1 1 * *", // 1:00 AM on the 1st of every month
    memory: "1GiB",
    timeoutSeconds: 540,
    region: "us-central1"
  },
  async (event) => {
    const startTime = Date.now();
    try {
      console.log(`🕒 [MONTHLY_GROUP_REPAYMENT_PROCESS] Started at ${new Date().toISOString()}`);
      await ensureGlobalConfig();
      console.log("[MONTHLY_GROUP_REPAYMENT_PROCESS] Global config & database initialized. Running processMonthlyGroupRepayments...");

      const { processMonthlyGroupRepayments } = require("./controllers/groupMonthlyPaymentController");
      
      const mockReq = { body: {} }; // defaults to previous month
      const mockRes = {
        status: (code) => ({
          json: (data) => console.log(`[MONTHLY_GROUP_REPAYMENT_PROCESS] Controller Result (${code}):`, JSON.stringify(data))
        })
      };

      await processMonthlyGroupRepayments(mockReq, mockRes);
      const duration = Date.now() - startTime;
      console.log(`✅ [MONTHLY_GROUP_REPAYMENT_PROCESS] Completed successfully in ${duration}ms.`);
    } catch (error) {
      console.error(`❌ [MONTHLY_GROUP_REPAYMENT_PROCESS] Failed after ${Date.now() - startTime}ms:`, error);
      throw error;
    }
  }
);

exports.mpesaReconciliationCron = onSchedule(
  {
    schedule: "0 18 * * *", // 6 PM daily
    timeZone: "Africa/Nairobi",
    memory: "1GiB",
    timeoutSeconds: 540,
    region: "us-central1"
  },
  async (event) => {
    const startTime = Date.now();
    try {
      console.log(`🕒 [RECONCILIATION_CRON] Started at ${new Date().toISOString()}`);
      await ensureGlobalConfig();
      console.log("[RECONCILIATION_CRON] Global config & database initialized. Running runReconciliation...");

      const { runReconciliation } = require("./utils/reconciliationService");
      const result = await runReconciliation();
      const duration = Date.now() - startTime;
      console.log(`✅ [RECONCILIATION_CRON] Completed successfully in ${duration}ms. Processed: ${result.processed}, Recovered: ${result.recoveredCount}, Failed: ${result.failedCount}`);

      // Proactively request Mpesa Paybill balance update
      const { requestPaybillBalance } = require("./utils/requestPaybillBalance");
      try {
        console.log("[RECONCILIATION_CRON] Requesting Mpesa Paybill balance update...");
        await requestPaybillBalance();
        console.log("[RECONCILIATION_CRON] Mpesa Paybill balance update request submitted successfully.");
      } catch (balError) {
        console.error("❌ [RECONCILIATION_CRON] Failed to request Paybill balance:", balError.message);
      }
    } catch (error) {
      console.error(`❌ [RECONCILIATION_CRON] Failed after ${Date.now() - startTime}ms:`, error);
      throw error;
    }
  }
);

exports.loanReminderAndOverdueCron = onSchedule(
  {
    schedule: "0 18 * * *", // 6 PM Nairobi time
    timeZone: "Africa/Nairobi",
    memory: "1GiB",
    timeoutSeconds: 540,
    region: "us-central1"
  },
  async (event) => {
    const startTime = Date.now();
    try {
      console.log(`🕒 [LOAN_REMINDER_CRON] Started at ${new Date().toISOString()} (Nairobi: ${new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })})`);
      await ensureGlobalConfig();
      console.log("[LOAN_REMINDER_CRON] Global config & database initialized. Running checkLoansAndSendReminders...");
      await checkLoansAndSendReminders();
      const duration = Date.now() - startTime;
      console.log(`✅ [LOAN_REMINDER_CRON] Completed successfully in ${duration}ms.`);
    } catch (error) {
      console.error(`❌ [LOAN_REMINDER_CRON] Failed after ${Date.now() - startTime}ms:`, error);
      throw error;
    }
  }
);

exports.creditScoreRecoveryCron = onSchedule(
  {
    schedule: "0 0 1 * *", // 12:00 AM on the 1st of the month Nairobi time
    timeZone: "Africa/Nairobi",
    memory: "1GiB",
    timeoutSeconds: 540,
    region: "us-central1"
  },
  async (event) => {
    const startTime = Date.now();
    try {
      console.log(`🕒 [CREDIT_SCORE_RECOVERY_CRON] Started at ${new Date().toISOString()} (Nairobi: ${new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })})`);
      await ensureGlobalConfig();
      console.log("[CREDIT_SCORE_RECOVERY_CRON] Global config & database initialized. Running runScoreRecovery...");
      await runScoreRecovery();
      const duration = Date.now() - startTime;
      console.log(`✅ [CREDIT_SCORE_RECOVERY_CRON] Completed successfully in ${duration}ms.`);
    } catch (error) {
      console.error(`❌ [CREDIT_SCORE_RECOVERY_CRON] Failed after ${Date.now() - startTime}ms:`, error);
      throw error;
    }
  }
);

console.log("🚀 Deployment timestamp:", new Date().toISOString());