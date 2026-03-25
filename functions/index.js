const { onRequest } = require("firebase-functions/v2/https");
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

// MPESA REVERSAL
const mpesaReversalUrl = defineSecret("MPESA_REVERSAL_URL");
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

    mpesaReversalUrl, mpesaReversalResult, mpesaReversalTimeout,

    mpesaC2bConfirmUrl, mpesaC2bValidateUrl,

    mpesaAccountBalanceResultUrl
  ],
});

/*************************************************
 * LOAD SECRETS (NO DB CONNECTION HERE)
 *************************************************/

onInit(async () => {
  console.log("🔥 Loading secrets...");

  const config = {
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

    mpesaEnv: (mpesaEnv.value() || "sandbox").trim().toLowerCase(),
    mpesaConsumerKey: mpesaConsumerKey.value(),
    mpesaConsumerSecret: mpesaConsumerSecret.value(),
    mpesaShortcode: mpesaShortcode.value(),
    mpesaPasskey: mpesaPasskey.value(),
    mpesaStkCallback: mpesaStkCallback.value(),

    mpesaB2cShortcode: mpesaB2cShortcode.value(),
    mpesaB2cInitiator: mpesaB2cInitiator.value(),
    mpesaB2cCredential: mpesaB2cCredential.value(),
    mpesaB2cResultUrl: mpesaB2cResultUrl.value(),
    mpesaB2cTimeoutUrl: mpesaB2cTimeoutUrl.value(),

    mpesaReversalUrl: mpesaReversalUrl.value(),
    mpesaReversalResult: mpesaReversalResult.value(),
    mpesaReversalTimeout: mpesaReversalTimeout.value(),

    mpesaC2bConfirmUrl: mpesaC2bConfirmUrl.value(),
    mpesaC2bValidateUrl: mpesaC2bValidateUrl.value(),

    mpesaAccountBalanceResultUrl:
      mpesaAccountBalanceResultUrl.value(),

    clientEmail: clientEmail.value(),
    fbPrivateKey: fbPrivateKey.value(),
    projectId: projectId.value(),
    storageBucket: storageBucket.value(),
  };

  global.config = config;

  console.log("✅ Secrets loaded");

  console.log("🚀 Initializing database and services...");

  await initializeApp(config);

  console.log("✅ App initialization complete");
});


// ----- Export HTTPS API -----
// exports.api = onRequest(
//   {
//     maxBodySize: "20mb",
//     timeoutSeconds: 540,
//     cors: true,
//     rawBody: true,

//     // 🔥 ADD THIS
//     minInstances: 1,
//     maxInstances: 10,
//   },
  
//   app
// );


/*************************************************
 * EXPORT API
 *************************************************/

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

console.log("🚀 Deployment timestamp:", new Date().toISOString());