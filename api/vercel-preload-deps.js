/**
 * Side-effect requires so Vercel's file tracer bundles deps used under `functions/`.
 * Only packages listed in the repo root package.json (Vercel installs root only).
 */
const PACKAGES = [
  "bcryptjs",
  "mongoose",
  "jsonwebtoken",
  "joi",
  "validator",
  "bullmq",
  "ioredis",
  "multer",
  "africastalking",
  "firebase-admin",
  "axios",
  "xss",
  "helmet",
  "express-rate-limit",
  "mongo-sanitize",
  "expo-server-sdk",
  "express-async-handler",
  "morgan",
  "cors",
  "twilio",
  "pdfkit",
  "qrcode",
  "node-cron",
  "node-cache",
  "moment",
  "qs",
  "uuid",
];

for (const name of PACKAGES) {
  try {
    require(name);
  } catch (err) {
    console.error(`[vercel-preload] Failed to load "${name}":`, err.message);
    throw err;
  }
}
