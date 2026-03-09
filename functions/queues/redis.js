const { Redis } = require("ioredis");

const bullRedis = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
  tls: process.env.REDIS_TLS === "true" ? {} : undefined,
});

bullRedis.on("connect", () => {
  console.log("✅ BullMQ Redis connected");
});

bullRedis.on("error", (err) => {
  console.error("❌ BullMQ Redis error:", err);
});

module.exports = bullRedis;