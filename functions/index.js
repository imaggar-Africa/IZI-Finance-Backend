// functions/index.js
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onInit } = require("firebase-functions/v2/core");
const { defineSecret } = require("firebase-functions/params");
const axios = require("axios");
require("dotenv").config();

const { app, initializeApp } = require("./app");

// ----- App / Service Secrets -----
const atUsername = defineSecret("AT_USERNAME");
const atApiKey = defineSecret("AT_API_KEY");
const atSenderId = defineSecret("AT_SENDER_ID");

const mongoUri = defineSecret("MONGO_URI");
const redisUrl = defineSecret("UPSTASH_REDIS_REST_URL");
const redisToken = defineSecret("UPSTASH_REDIS_REST_TOKEN");

const jwtAccessSecret = defineSecret("JWT_ACCESS_SECRET");
const jwtRefreshSecret = defineSecret("JWT_REFRESH_SECRET");
const jwtAccessTtl = defineSecret("JWT_ACCESS_TTL");
const jwtRefreshTtl = defineSecret("JWT_REFRESH_TTL");

const clientEmail = defineSecret("CLIENT_EMAIL");
const fbPrivateKey = defineSecret("FB_PRIVATE_KEY");
const projectId = defineSecret("PROJECT_ID");
const storageBucket = defineSecret("STORAGE_BUCKET");

// ----- M-Pesa STK Secrets -----
const mpesaEnv = defineSecret("MPESA_ENV");
const mpesaConsumerKey = defineSecret("MPESA_CONSUMER_KEY");
const mpesaConsumerSecret = defineSecret("MPESA_CONSUMER_SECRET");
const mpesaShortcode = defineSecret("MPESA_SHORTCODE");
const mpesaPasskey = defineSecret("MPESA_PASSKEY");
const mpesaStkCallback = defineSecret("MPESA_STK_CALLBACK_URL");

// ----- M-Pesa B2C Secrets -----
const mpesaB2cShortcode = defineSecret("MPESA_B2C_SHORTCODE");
const mpesaB2cInitiator = defineSecret("MPESA_B2C_INITIATOR");
const mpesaB2cCredential = defineSecret("MPESA_B2C_SECURITY_CREDENTIAL");
const mpesaB2cResultUrl = defineSecret("MPESA_B2C_RESULT_URL");
const mpesaB2cTimeoutUrl = defineSecret("MPESA_B2C_TIMEOUT_URL");

// ----- M-Pesa Reversal Secrets -----
const mpesaReversalUrl = defineSecret("MPESA_REVERSAL_URL");
const mpesaReversalResult = defineSecret("MPESA_REVERSAL_RESULT_URL");
const mpesaReversalTimeout = defineSecret("MPESA_REVERSAL_TIMEOUT_URL");

// ----- M-Pesa C2B Secrets -----
const mpesaC2bConfirmUrl = defineSecret("MPESA_CONFIRM_URL");
const mpesaC2bValidateUrl = defineSecret("MPESA_VALIDATE_URL");


// ----- M-Pesa Account Balance Secrets -----
const mpesaAccountBalanceResultUrl = defineSecret(
  "MPESA_ACCOUNT_BALANCE_RESULT_URL"
);

// ----- Set global options -----
setGlobalOptions({
  region: "us-central1",
  timeoutSeconds: 700,
  memory: "2GiB",
  secrets: [
    // App / service secrets
    atUsername, atApiKey, atSenderId,
    mongoUri, redisUrl, redisToken,
    jwtAccessSecret, jwtRefreshSecret, jwtAccessTtl, jwtRefreshTtl,
    clientEmail, fbPrivateKey, projectId, storageBucket,

    // M-Pesa STK
    mpesaEnv, mpesaConsumerKey, mpesaConsumerSecret,
    mpesaShortcode, mpesaPasskey, mpesaStkCallback,

    // M-Pesa B2C
    mpesaB2cShortcode, mpesaB2cInitiator, mpesaB2cCredential,
    mpesaB2cResultUrl, mpesaB2cTimeoutUrl,

    // M-Pesa Reversal
    mpesaReversalUrl, mpesaReversalResult, mpesaReversalTimeout,

    
    // M-Pesa C2B
    mpesaC2bConfirmUrl, mpesaC2bValidateUrl,

    
    // ✅ ADD THIS
    mpesaAccountBalanceResultUrl,

  ],
});

// ----- Initialize app on function startup -----
onInit(async () => {
  console.log("🔥 Initializing application with secrets...");

  // Build config from secrets
  global.config = {
    mongoUri: mongoUri.value(),
    redisUrl: redisUrl.value(),
    redisToken: redisToken.value(),

    jwtAccessSecret: jwtAccessSecret.value(),
    jwtRefreshSecret: jwtRefreshSecret.value(),
    jwtAccessTtl: jwtAccessTtl.value(),
    jwtRefreshTtl: jwtRefreshTtl.value(),

    atUsername: atUsername.value(),
    atApiKey: atApiKey.value(),
    atSenderId: atSenderId.value(),

    // M-Pesa STK
mpesaEnv: (mpesaEnv.value() || "sandbox").trim().toLowerCase(),
    mpesaConsumerKey: mpesaConsumerKey.value(),
    mpesaConsumerSecret: mpesaConsumerSecret.value(),
    mpesaShortcode: mpesaShortcode.value(),
    mpesaPasskey: mpesaPasskey.value(),
    mpesaStkCallback: mpesaStkCallback.value(),

    // M-Pesa B2C
    mpesaB2cShortcode: mpesaB2cShortcode.value(),
    mpesaB2cInitiator: mpesaB2cInitiator.value(),
    mpesaB2cCredential: mpesaB2cCredential.value(),
    mpesaB2cResultUrl: mpesaB2cResultUrl.value(),
    mpesaB2cTimeoutUrl: mpesaB2cTimeoutUrl.value(),

    // M-Pesa Reversal
    mpesaReversalUrl: mpesaReversalUrl.value(),
    mpesaReversalResult: mpesaReversalResult.value(),
    mpesaReversalTimeout: mpesaReversalTimeout.value(),

    clientEmail: clientEmail.value(),
    fbPrivateKey: fbPrivateKey.value(),
    projectId: projectId.value(),
    storageBucket: storageBucket.value(),

        // M-Pesa C2B
    mpesaC2bConfirmUrl: mpesaC2bConfirmUrl.value(),
    mpesaC2bValidateUrl: mpesaC2bValidateUrl.value(),

    
    
   // ✅ ADD THIS
    mpesaAccountBalanceResultUrl:
      mpesaAccountBalanceResultUrl.value(),
    
    
  };

  // Initialize your app with global config
  await initializeApp(global.config);

  console.log("✅ Initialization completed.");
});

// ----- For specific routes that need longer timeouts -----
const longRunningOpts = {
  timeoutSeconds: 540,
  memory: "2GiB", // Note: Use "GiB" instead of "GB" for Firebase v2
  minInstances: 0,
  maxInstances: 10
};
// ----- M-Pesa Token Generation Function -----

// ----- M-Pesa Token Generation Function -----




// ----- Export HTTPS API -----
exports.api = onRequest(
  {
    maxBodySize: "20mb",
    timeoutSeconds: 540,
    cors: true,
    rawBody: true,      // 🔥 REQUIRED FOR MULTIPART / RAW POST (M-Pesa callback)
  },
  app
);

console.log("Deployment timestamp: " + new Date().toISOString());