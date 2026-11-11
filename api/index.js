/**
 * Vercel serverless entry — same Express app as Firebase (`functions/app.js`).
 * Firebase deploy remains unchanged (`functions/index.js`).
 */
const path = require("path");
const Module = require("module");

const projectRoot = path.join(__dirname, "..");
const moduleSearchPaths = [
  path.join(projectRoot, "node_modules"),
  path.join(projectRoot, "functions", "node_modules"),
];
const existingNodePath = process.env.NODE_PATH
  ? process.env.NODE_PATH.split(path.delimiter)
  : [];
process.env.NODE_PATH = [...existingNodePath, ...moduleSearchPaths].join(
  path.delimiter,
);
Module._initPaths();

// Load .env from repo root when running `vercel dev` locally
if (!process.env.VERCEL) {
  require("dotenv").config({ path: path.join(projectRoot, ".env") });
} else if (process.env.NODE_ENV !== "production") {
  require("dotenv").config({ path: path.join(projectRoot, ".env") });
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
          missing.join(", "),
        );
      }

      if (!global.config || Object.keys(global.config).length === 0) {
        global.config = buildConfigFromEnv();
      }

      await initializeApp(global.config);

      if (process.env.ENABLE_SMS_WORKER === "true") {
        try {
          const { startWorker } = require("../functions/queues/sms.worker");
          startWorker().catch((workerErr) =>
            console.error("❌ SMS worker failed to start on Vercel:", workerErr)
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

function formatInitError(err) {
  const missingEnv = getMissingFirebaseEnvKeys();
  return {
    error: "Server initialization failed",
    details: err.message,
    initStep: err.initStep || null,
    missingEnv: missingEnv.length ? missingEnv : undefined,
    mongoUriConfigured: Boolean(
      process.env.MONGO_URI ||
        process.env.Database ||
        process.env.DATABASE_URL ||
        global.config?.mongoUri
    ),
    stack: err.stack || null,
    vercelRequestId: null,
  };
}

module.exports = async (req, res) => {
  try {
    if (!isHealthPath(req.url)) {
      await ensureInit();
    }
    return app(req, res);
  } catch (err) {
    const payload = formatInitError(err);
    payload.vercelRequestId = req.headers["x-vercel-id"] || null;

    console.error("❌ Vercel handler init error:", err.message);
    console.error("initStep:", payload.initStep);
    console.error("missingEnv:", payload.missingEnv);
    console.error(err.stack);

    if (!res.headersSent) {
      res.status(500).json(payload);
    }
  }
};
