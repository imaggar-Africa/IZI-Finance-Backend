/**
 * Eager requires from the api entry so Vercel's bundler includes these packages.
 * Keep in sync with `npm run check:vercel-deps`.
 */
const PACKAGES = [
  "@fastify/busboy",
  "@sendgrid/mail",
  "@upstash/redis",
  "africastalking",
  "axios",
  "bcryptjs",
  "bullmq",
  "cors",
  "dotenv",
  "expo-server-sdk",
  "express",
  "express-async-handler",
  "express-rate-limit",
  "firebase-admin",
  "helmet",
  "ioredis",
  "joi",
  "jsonwebtoken",
  "moment",
  "mongo-sanitize",
  "mongoose",
  "morgan",
  "multer",
  "node-cache",
  "node-cron",
  "pdfkit",
  "qrcode",
  "qs",
  "redis",
  "uuid",
  "validator",
  "xss",
];

for (const name of PACKAGES) {
  require(name);
}
