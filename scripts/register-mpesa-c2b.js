#!/usr/bin/env node
/**
 * Re-register M-Pesa C2B validation + confirmation URLs (overwrites previous URLs for the paybill).
 * No separate "unregister" on Safaricom — one successful register replaces the old Firebase/old host URLs.
 *
 *   npm run c2b:register
 *   npm run c2b:register -- --base https://vercel-izi-finance-backend.vercel.app
 */
const path = require("path");
const axios = require("axios");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { buildConfigFromEnv } = require("../functions/config/buildConfigFromEnv");
const { getMpesaToken } = require("../functions/utils/mpesaC2BService");
const { resolveC2bCallbackUrls } = require("../functions/utils/c2bResolve");

function parseArgs() {
  const args = process.argv.slice(2);
  let base = null;
  let apiVersion = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base" && args[i + 1]) {
      base = args[++i].replace(/\/$/, "");
    }
    if (args[i] === "--v1") apiVersion = "v1";
    if (args[i] === "--v2") apiVersion = "v2";
  }
  return { base, apiVersion };
}

function registerEndpoint(mode, version) {
  const v = version === "v1" ? "v1" : "v2";
  const host =
    mode === "live"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
  return `${host}/mpesa/c2b/${v}/registerurl`;
}

function explainRegisterError(body, mode) {
  const code = body?.errorCode || body?.errorCode;
  if (code === "500.003.1001") {
    console.error(`
Likely causes for 500.003.1001 in ${mode.toUpperCase()}:
  1) URLs already registered for this paybill — in PRODUCTION you must DELETE old URLs first:
       Daraja portal → Self Service → URL Management → remove Validation + Confirmation URLs
     (two Business Manager / Administrator approvals may be required), then run this script again.
  2) Daraja app API product vs endpoint mismatch — My Apps → your LIVE app → API Products:
       use /mpesa/c2b/v2/registerurl only if C2B v2 is enabled; otherwise npm run c2b:register -- --v1
  3) Safaricom temporary outage — retry in 10–30 minutes.
  4) URLs still registered on an old aggregator/MPLS — contact Safaricom support to clear.
`);
  }
}

async function probeCallbackUrls(validateUrl, confirmUrl, healthUrl) {
  try {
    const h = await axios.get(healthUrl, {
      timeout: 15000,
      validateStatus: () => true,
    });
    const ok =
      h.status === 200 && h.data?.success === true ? "OK" : `HTTP ${h.status}`;
    console.log(`  GET ${healthUrl}: ${ok}`);
  } catch (e) {
    console.warn(`  GET ${healthUrl}: not reachable — ${e.message}`);
  }

  for (const [label, url] of [
    ["validate (POST)", validateUrl],
    ["confirm (POST)", confirmUrl],
  ]) {
    try {
      const r = await axios.post(
        url,
        {},
        {
          timeout: 15000,
          headers: { "Content-Type": "application/json" },
          validateStatus: () => true,
        }
      );
      const ok =
        r.status === 200 && typeof r.data?.ResultCode !== "undefined"
          ? `OK (M-Pesa ResultCode ${r.data.ResultCode})`
          : `HTTP ${r.status}`;
      console.log(`  ${label}: ${ok}`);
    } catch (e) {
      console.warn(`  ${label}: not reachable — ${e.message}`);
    }
  }
  console.log(
    "  (GET on /validate or /confirm returns 404 — that is normal; Safaricom uses POST.)"
  );
}

async function callRegister(registerUrl, token, payload) {
  const { data, status } = await axios.post(registerUrl, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    timeout: 25000,
    validateStatus: () => true,
  });
  return { data, status, ok: status >= 200 && status < 300 };
}

async function main() {
  const { base: baseOverride, apiVersion } = parseArgs();

  global.config = buildConfigFromEnv();

  const mode = (global.config.mpesaEnv || "sandbox").trim().toLowerCase();

  const { validateUrl, confirmUrl, source } = resolveC2bCallbackUrls(
    global.config,
    baseOverride || undefined
  );
  const apiBase = validateUrl.replace(/\/api\/c2b\/validate$/, "");
  const shortCodeRaw = (global.config.mpesaShortcode || "").trim();
  const shortCodeNum = parseInt(shortCodeRaw, 10);

  if (!shortCodeRaw || shortCodeRaw.length < 5 || Number.isNaN(shortCodeNum)) {
    console.error("Missing or invalid MPESA_SHORTCODE in .env");
    process.exit(1);
  }
  if (!validateUrl.startsWith("https://") || !confirmUrl.startsWith("https://")) {
    console.error("Validate and confirm URLs must be HTTPS:", {
      validateUrl,
      confirmUrl,
    });
    process.exit(1);
  }

  console.log("Re-registering C2B URLs with Safaricom…\n");
  console.log({
    environment: mode.toUpperCase(),
    ShortCode: shortCodeNum,
    urlSource: source,
    ValidationURL: validateUrl,
    ConfirmationURL: confirmUrl,
  });

  const healthUrl = `${apiBase}/api/c2b/health`;
  console.log("\nCallback reachability:");
  await probeCallbackUrls(validateUrl, confirmUrl, healthUrl);

  let token;
  try {
    token = await getMpesaToken();
    console.log("\nDaraja OAuth: OK (access token received)");
  } catch (e) {
    console.error("Daraja OAuth failed — check MPESA_CONSUMER_KEY/SECRET and MPESA_ENV:", e.message);
    process.exit(1);
  }

  const payload = {
    ShortCode: shortCodeNum,
    ResponseType: "Completed",
    ConfirmationURL: confirmUrl,
    ValidationURL: validateUrl,
  };

  const versionsToTry = apiVersion ? [apiVersion] : ["v2"];

  let lastFail = null;
  for (let i = 0; i < versionsToTry.length; i++) {
    const version = versionsToTry[i];
    const registerUrl = registerEndpoint(mode, version);
    const authToken =
      i === 0 ? token : await getMpesaToken();
    console.log(`\nPOST ${registerUrl} …`);
    const { data, status, ok } = await callRegister(
      registerUrl,
      authToken,
      payload
    );
    if (ok) {
      console.log("\nSafaricom response:", JSON.stringify(data, null, 2));
      console.log(
        `\nDone (${version}). Paybill callbacks will use the URLs above.`
      );
      return;
    }
    lastFail = { version, status, data, registerUrl };
    console.error(`Failed (${version}) HTTP ${status}:`, data);
    if (apiVersion) break;
  }

  if (!apiVersion && lastFail?.version === "v2" && lastFail.status === 500) {
    console.log(
      "\nOptional: if Daraja API Products include C2B v1 only, retry with:\n  npm run c2b:register -- --v1"
    );
  }

  if (lastFail) {
    explainRegisterError(lastFail.data, mode);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("C2B register failed:", err.response?.data || err.message);
  process.exit(1);
});