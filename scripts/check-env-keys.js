#!/usr/bin/env node
/**
 * Compare local .env keys to Firebase Secret names used in production.
 * Does not print secret values.
 */
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const {
  FIREBASE_ENV_KEYS,
  getMissingFirebaseEnvKeys,
} = require("../functions/config/buildConfigFromEnv");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn("No root .env found — using process.env only.");
}

const missing = getMissingFirebaseEnvKeys();
const vercelOnly = [
  "CRON_SECRET",
  "CRON_BASE_URL",
  "QSTASH_CURRENT_SIGNING_KEY",
  "QSTASH_NEXT_SIGNING_KEY",
  "CRON_TEST_SMS",
  "CRON_TEST_LENDER_PHONES",
  "ENABLE_SMS_WORKER",
  "NODE_ENV",
];

console.log("\nFirebase-aligned keys (required unless optional in buildConfig):");
console.log(FIREBASE_ENV_KEYS.join(", "));

console.log("\nVercel-only (add in dashboard):");
console.log(vercelOnly.join(", "));

if (missing.length) {
  console.log("\n❌ Missing or empty in current environment:");
  missing.forEach((k) => console.log("  -", k));
  process.exitCode = 1;
} else {
  console.log("\n✅ All required Firebase-aligned env keys are set.");
}
