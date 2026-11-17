#!/usr/bin/env node
/**
 * Remove stale SMS rows from MongoDB (sms_queue).
 *
 *   npm run sms:clear              — dry-run counts
 *   npm run sms:clear -- --yes     — delete Pending / Waiting for Balance / Processing
 *   npm run sms:clear -- --yes --failed  — also delete Failed
 *
 * Live (browser): see VERCEL.md — /api/admin/clear-sms-queue?token=CRON_SECRET
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const { clearStaleSmsQueue } = require("../functions/utils/clearSmsQueue");

const LIVE_BASE = "https://vercel-izi-finance-backend.vercel.app";

async function main() {
  const uri = process.env.MONGO_URI?.trim();
  if (!uri) {
    console.error("Missing MONGO_URI in .env");
    process.exit(1);
  }

  const yes = process.argv.includes("--yes");
  const includeFailed = process.argv.includes("--failed");
  const cronBase = (process.env.CRON_BASE_URL || LIVE_BASE).replace(/\/$/, "");

  console.log("CRON_BASE_URL (live Vercel):", cronBase);

  await mongoose.connect(uri);

  const result = await clearStaleSmsQueue({
    dryRun: !yes,
    includeFailed,
  });

  console.log(JSON.stringify(result, null, 2));

  if (!yes) {
    console.log("\nDry run only. Re-run with: npm run sms:clear -- --yes");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});