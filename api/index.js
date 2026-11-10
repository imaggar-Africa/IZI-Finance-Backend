/**
 * Vercel serverless entry — same Express app as Firebase (`functions/app.js`).
 * Firebase deploy remains unchanged (`functions/index.js`).
 */
const path = require("path");

// Load .env from repo root when running `vercel dev` locally
if (!process.env.VERCEL) {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
} else if (process.env.NODE_ENV !== "production") {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
}

process.env.IZI_RUNTIME = process.env.IZI_RUNTIME || "vercel";

const { app, initializeApp } = require("../functions/app");
const {
  buildConfigFromEnv,
  getMissingFirebaseEnvKeys,
} = require("../functions/config/buildConfigFromEnv");

let initPromise = null;

function ensureInit() {
  if (!initPromise) {
    initPromise = (async () => {
      const missing = getMissingFirebaseEnvKeys();
      if (missing.length) {
        console.warn(
          "⚠️ Missing env vars for Vercel (Firebase secret names):",
          missing.join(", ")
        );
      }

      if (!global.config || Object.keys(global.config).length === 0) {
        global.config = buildConfigFromEnv();
      }

      await initializeApp(global.config);

      if (process.env.ENABLE_SMS_WORKER === "true") {
        try {
          const { startWorker } = require("../functions/queues/sms.worker");
          startWorker().catch((err) =>
            console.error("❌ SMS worker failed to start on Vercel:", err)
          );
          console.log("🚀 SMS worker started (ENABLE_SMS_WORKER=true)");
        } catch (err) {
          console.warn("⚠️ Could not load SMS worker:", err.message);
        }
      }
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

function isHealthPath(url = "") {
  const pathOnly = url.split("?")[0];
  return (
    pathOnly === "/healthz" ||
    pathOnly === "/ping" ||
    pathOnly === "/version" ||
    pathOnly === "/"
  );
}

module.exports = async (req, res) => {
  try {
    if (!isHealthPath(req.url)) {
      await ensureInit();
    }
    return app(req, res);
  } catch (err) {
    console.error("❌ Vercel handler init error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Server initialization failed",
        details: err.message,
      });
    }
  }
};
