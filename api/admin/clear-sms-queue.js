/**
 * Clear stale sms_queue rows (browser or curl). No token (set SMS_CLEAR_DISABLED=true to turn off).
 * GET: /api/admin/clear-sms-queue
 * Preview: &dry=1 | Include Failed: &failed=1
 */
const path = require("path");

require(path.join(__dirname, "..", "vercel-node-path"));

let bootError = null;
let initializeApp;
let buildConfigFromEnv;
let clearStaleSmsQueue;

try {
  if (!process.env.VERCEL) {
    require("dotenv").config({
      path: path.join(__dirname, "..", "..", ".env"),
    });
  }

  process.env.IZI_RUNTIME = process.env.IZI_RUNTIME || "vercel";

  ({ initializeApp } = require("../../functions/app"));
  ({ buildConfigFromEnv } = require("../../functions/config/buildConfigFromEnv"));
  ({ clearStaleSmsQueue } = require("../../functions/utils/clearSmsQueue"));
} catch (err) {
  bootError = err;
  console.error("clear-sms-queue boot error:", err);
}

let initPromise = null;

function ensureInit() {
  if (!initPromise) {
    initPromise = (async () => {
      if (!global.config || Object.keys(global.config).length === 0) {
        global.config = buildConfigFromEnv();
      }
      await initializeApp(global.config);
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

function wantsHtml(req) {
  const accept = req.headers?.accept || "";
  return accept.includes("text/html");
}

module.exports = async (req, res) => {
  if (bootError) {
    res.status(500).json({
      error: "Handler failed to load",
      detail: bootError.message,
    });
    return;
  }

  if (process.env.SMS_CLEAR_DISABLED === "true") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const dryRun = req.query?.dry === "1" || req.query?.dry === "true";
  const includeFailed =
    req.query?.failed === "1" || req.query?.failed === "true";

  try {
    console.warn("[clear-sms-queue] invoked", {
      dryRun,
      includeFailed,
      ip: req.headers["x-forwarded-for"] || req.headers["x-real-ip"],
    });
    await ensureInit();
    const result = await clearStaleSmsQueue({ dryRun, includeFailed });

    const payload = {
      ...result,
      cronBaseUrl: process.env.CRON_BASE_URL || null,
      includeFailed,
      note: dryRun
        ? "Dry run only. Omit &dry=1 to delete."
        : "Stale SMS rows removed from sms_queue.",
    };

    if (wantsHtml(req)) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.status(200).send(
        `<!DOCTYPE html><html><head><title>SMS queue clear</title></head><body><pre>${JSON.stringify(payload, null, 2)}</pre></body></html>`
      );
      return;
    }

    res.status(200).json(payload);
  } catch (err) {
    console.error("[clear-sms-queue]", err);
    res.status(500).json({ error: err.message });
  }
};