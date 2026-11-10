/**
 * Single env → global.config map (matches Firebase `functions/index.js` onInit).
 * Used by Vercel (`api/`) and as fallback in `initializeApp`.
 */
function clean(val) {
  if (val == null) return "";
  let str = String(val).trim();
  if (str.startsWith('"') && str.endsWith('"')) {
    str = str.slice(1, -1).trim();
  }
  if (str.startsWith("'") && str.endsWith("'")) {
    str = str.slice(1, -1).trim();
  }
  return str;
}

/** Firebase Secret Manager / Vercel env var names */
const FIREBASE_ENV_KEYS = [
  "AT_USERNAME",
  "AT_API_KEY",
  "AT_SENDER_ID",
  "MONGO_URI",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "JWT_ACCESS_TTL",
  "JWT_REFRESH_TTL",
  "CLIENT_EMAIL",
  "FB_PRIVATE_KEY",
  "PROJECT_ID",
  "STORAGE_BUCKET",
  "MPESA_ENV",
  "MPESA_CONSUMER_KEY",
  "MPESA_CONSUMER_SECRET",
  "MPESA_SHORTCODE",
  "MPESA_PASSKEY",
  "MPESA_STK_CALLBACK_URL",
  "MPESA_B2C_SHORTCODE",
  "MPESA_B2C_INITIATOR",
  "MPESA_B2C_SECURITY_CREDENTIAL",
  "MPESA_B2C_RESULT_URL",
  "MPESA_B2C_TIMEOUT_URL",
  "MPESA_REVERSAL_URL",
  "MPESA_REVERSAL_RESULT_URL",
  "MPESA_REVERSAL_TIMEOUT_URL",
  "MPESA_CONFIRM_URL",
  "MPESA_VALIDATE_URL",
  "MPESA_ACCOUNT_BALANCE_RESULT_URL",
];

function buildConfigFromEnv(env = process.env) {
  return {
    mongoUri: clean(env.MONGO_URI),
    redisUrl: clean(env.UPSTASH_REDIS_REST_URL),
    redisToken: clean(env.UPSTASH_REDIS_REST_TOKEN),

    jwtAccessSecret: clean(env.JWT_ACCESS_SECRET),
    jwtRefreshSecret: clean(env.JWT_REFRESH_SECRET),
    jwtAccessTtl: clean(env.JWT_ACCESS_TTL),
    jwtRefreshTtl: clean(env.JWT_REFRESH_TTL),

    atUsername: clean(env.AT_USERNAME),
    atApiKey: clean(env.AT_API_KEY),
    atSenderId: clean(env.AT_SENDER_ID),

    mpesaEnv: clean(env.MPESA_ENV || "sandbox").toLowerCase(),
    mpesaConsumerKey: clean(env.MPESA_CONSUMER_KEY),
    mpesaConsumerSecret: clean(env.MPESA_CONSUMER_SECRET),
    mpesaShortcode: clean(env.MPESA_SHORTCODE),
    mpesaPasskey: clean(env.MPESA_PASSKEY),
    mpesaStkCallback: clean(env.MPESA_STK_CALLBACK_URL),

    mpesaB2cShortcode: clean(env.MPESA_B2C_SHORTCODE),
    mpesaB2cInitiator: clean(env.MPESA_B2C_INITIATOR),
    mpesaB2cCredential: clean(env.MPESA_B2C_SECURITY_CREDENTIAL),
    mpesaB2cResultUrl: clean(env.MPESA_B2C_RESULT_URL),
    mpesaB2cTimeoutUrl: clean(env.MPESA_B2C_TIMEOUT_URL),

    mpesaReversalUrl: clean(env.MPESA_REVERSAL_URL),
    mpesaReversalResult: clean(env.MPESA_REVERSAL_RESULT_URL),
    mpesaReversalTimeout: clean(env.MPESA_REVERSAL_TIMEOUT_URL),

    mpesaC2bConfirmUrl: clean(env.MPESA_CONFIRM_URL),
    mpesaC2bValidateUrl: clean(env.MPESA_VALIDATE_URL),

    mpesaAccountBalanceResultUrl: clean(env.MPESA_ACCOUNT_BALANCE_RESULT_URL),

    clientEmail: clean(env.CLIENT_EMAIL),
    fbPrivateKey: clean(env.FB_PRIVATE_KEY),
    projectId: clean(env.PROJECT_ID),
    storageBucket: clean(env.STORAGE_BUCKET),

    redisHost: clean(env.REDIS_HOST),
    redisPort: clean(env.REDIS_PORT),
    redisPassword: clean(env.REDIS_PASSWORD),
    redisTls: clean(env.REDIS_TLS),
  };
}

function getMissingFirebaseEnvKeys(env = process.env) {
  const optional = new Set([
    "JWT_ACCESS_TTL",
    "JWT_REFRESH_TTL",
    "MPESA_ENV",
    "REDIS_HOST",
    "REDIS_PORT",
    "REDIS_PASSWORD",
    "REDIS_TLS",
  ]);
  return FIREBASE_ENV_KEYS.filter((key) => {
    if (optional.has(key)) return false;
    return !clean(env[key]);
  });
}

module.exports = {
  buildConfigFromEnv,
  getMissingFirebaseEnvKeys,
  FIREBASE_ENV_KEYS,
};
