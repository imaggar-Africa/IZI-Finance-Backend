/**
 * Eager requires from the api entry so Vercel's bundler includes these packages.
 * Keep in sync with `npm run check:vercel-deps`.
 */
// Base libs first — scoped packages (e.g. @sendgrid/mail) need axios/express in the bundle already.
const PACKAGES = [
  "axios",
  "express",
  "dotenv",
  "cors",
  "bcryptjs",
  "mongoose",
  "joi",
  "jsonwebtoken",
  "firebase-admin",
  "helmet",
  "morgan",
  "multer",
  "validator",
  "mongo-sanitize",
  "xss",
  "bullmq",
  "ioredis",
  "redis",
  "@upstash/redis",
  "africastalking",
  "express-async-handler",
  "express-rate-limit",
  "moment",
  "qs",
  "uuid",
  "node-cache",
  "node-cron",
  "pdfkit",
  "qrcode",
  "expo-server-sdk",
  "@fastify/busboy",
  "@sendgrid/mail",
];

for (const name of PACKAGES) {
  try {
    require(name);
  } catch (err) {
    const wrapped = new Error(
      `[ensure-vercel-deps] Cannot load "${name}": ${err.message}`,
    );
    wrapped.cause = err;
    wrapped.packageName = name;
    throw wrapped;
  }
}
