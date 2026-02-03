require("dotenv").config();

module.exports = async function localInit() {
  if (global.config) {
    console.log("ℹ️ global.config already initialized");
    return;
  }

  console.log("🟡 Initializing local global.config...");

  global.config = {
    mongoUri: process.env.MONGO_URI,

    mpesaEnv: (process.env.MPESA_ENV || "sandbox").trim().toLowerCase(),
    mpesaConsumerKey: process.env.MPESA_CONSUMER_KEY,
    mpesaConsumerSecret: process.env.MPESA_CONSUMER_SECRET,
    mpesaShortcode: process.env.MPESA_SHORTCODE,
    mpesaPasskey: process.env.MPESA_PASSKEY,
    mpesaStkCallback: process.env.MPESA_STK_CALLBACK_URL,

    mpesaB2cShortcode: process.env.MPESA_B2C_SHORTCODE,
    mpesaB2cInitiator: process.env.MPESA_B2C_INITIATOR,
    mpesaB2cCredential: process.env.MPESA_B2C_SECURITY_CREDENTIAL,
    mpesaB2cResultUrl: process.env.MPESA_B2C_RESULT_URL,
    mpesaB2cTimeoutUrl: process.env.MPESA_B2C_TIMEOUT_URL,

    mpesaReversalUrl: process.env.MPESA_REVERSAL_URL,
    mpesaReversalResult: process.env.MPESA_REVERSAL_RESULT_URL,
    mpesaReversalTimeout: process.env.MPESA_REVERSAL_TIMEOUT_URL,
  };

  console.log("✅ Local MPESA config initialized");
};
