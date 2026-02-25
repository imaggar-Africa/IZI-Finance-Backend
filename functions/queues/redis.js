const { Redis } = require("ioredis");

const bullRedis = new Redis({
  host: "18.61.89.50",
  port: 6379,
  maxRetriesPerRequest: null,
});

bullRedis.on("connect", () => {
  console.log("✅ BullMQ Redis connected");
});

bullRedis.on("error", (err) => {
  console.error("❌ BullMQ Redis error:", err);
});

module.exports = bullRedis;