// config/db.js
const mongoose = require("mongoose");

const SERVERLESS =
  process.env.IZI_RUNTIME === "vercel" || Boolean(process.env.VERCEL);

function resolveMongoUri(mongoUri) {
  return (
    mongoUri ||
    process.env.MONGO_URI ||
    process.env.DATABASE_URL ||
    global.config?.mongoUri ||
    ""
  ).trim();
}

function mongoConnectOptions() {
  return {
    serverSelectionTimeoutMS: SERVERLESS ? 8000 : 30000,
    socketTimeoutMS: 45000,
    maxPoolSize: SERVERLESS ? 5 : 10,
    ...(SERVERLESS ? { bufferCommands: false } : {}),
  };
}

const connectDB = async (mongoUri) => {
  const uri = resolveMongoUri(mongoUri);

  if (!uri) {
    const msg = "MONGO_URI not set; skipping MongoDB connection.";
    if (SERVERLESS) {
      throw new Error(msg);
    }
    console.warn(`⚠️ ${msg}`);
    return;
  }

  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (mongoose.connection.readyState === 2) {
    await waitForMongoReady(15000);
    return;
  }

  const opts = mongoConnectOptions();
  try {
    await mongoose.connect(uri, opts);
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    await new Promise((res) => setTimeout(res, 1000));
    try {
      await mongoose.connect(uri, opts);
      console.log("✅ MongoDB connected on retry");
    } catch (retryErr) {
      console.error("❌ MongoDB retry failed:", retryErr.message);
      throw retryErr;
    }
  }
};

/** Wait until mongoose is connected (serverless cold start / late connect). */
async function waitForMongoReady(timeoutMs = 12000) {
  const uri = resolveMongoUri();
  if (!uri) {
    throw new Error("MONGO_URI not configured");
  }
  if (mongoose.connection.readyState === 1) {
    return;
  }
  if (mongoose.connection.readyState === 0) {
    await connectDB(uri);
    if (mongoose.connection.readyState === 1) return;
  }
  const start = Date.now();
  while (mongoose.connection.readyState !== 1) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `MongoDB not ready after ${timeoutMs}ms (readyState=${mongoose.connection.readyState})`
      );
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

function isMongoReady() {
  return mongoose.connection.readyState === 1;
}

module.exports = connectDB;
module.exports.waitForMongoReady = waitForMongoReady;
module.exports.isMongoReady = isMongoReady;
module.exports.mongoose = mongoose;
