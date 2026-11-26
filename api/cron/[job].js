/**
 * Scheduled jobs invoked by Upstash QStash (primary on Vercel).
 * Optional: Bearer CRON_SECRET for manual runs. Firebase onSchedule unchanged.
 */
const path = require("path");

require(path.join(__dirname, "..", "vercel-node-path"));

let bootError = null;
let initializeApp;
let buildConfigFromEnv;
let authorizeCron;
let resolveJobSlug;

try {
  if (!process.env.VERCEL) {
    require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
  }

  process.env.IZI_RUNTIME = process.env.IZI_RUNTIME || "vercel";

  ({ initializeApp } = require("../../functions/app"));
  ({ buildConfigFromEnv } = require("../../functions/config/buildConfigFromEnv"));
  ({ authorizeCron, resolveJobSlug } = require("./authorize"));
} catch (err) {
  bootError = err;
  console.error("Cron handler boot error:", err);
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

const jobs = {
  "loan-reminder": async () => {
    const { checkLoansAndSendReminders } = require("../../functions/utils/cron/loanCron");
    await checkLoansAndSendReminders();
    return { ok: true, job: "loan-reminder" };
  },
  reconciliation: async () => {
    const { runReconciliation } = require("../../functions/utils/reconciliationService");
    const result = await runReconciliation();
    const { requestPaybillBalance } = require("../../functions/utils/requestPaybillBalance");
    try {
      await requestPaybillBalance();
    } catch (err) {
      console.warn("Paybill balance request failed:", err.message);
    }
    return { ok: true, job: "reconciliation", ...result };
  },
  "group-health": async () => {
    const { checkGroupHealth } = require("../../functions/controllers/groupAlertController");
    await new Promise((resolve, reject) => {
      const mockRes = {
        status: () => ({
          json: (data) => {
            resolve(data);
            return mockRes;
          },
        }),
      };
      checkGroupHealth({}, mockRes).catch(reject);
    });
    return { ok: true, job: "group-health" };
  },
  "monthly-group-repayment": async () => {
    const {
      processMonthlyGroupRepayments,
    } = require("../../functions/controllers/groupMonthlyPaymentController");
    await new Promise((resolve, reject) => {
      const mockRes = {
        status: () => ({
          json: (data) => {
            resolve(data);
            return mockRes;
          },
        }),
      };
      processMonthlyGroupRepayments({ body: {} }, mockRes).catch(reject);
    });
    return { ok: true, job: "monthly-group-repayment" };
  },
  "credit-score-recovery": async () => {
    const { runScoreRecovery } = require("../../functions/utils/cron/loanCron");
    await runScoreRecovery();
    return { ok: true, job: "credit-score-recovery" };
  },
};

function smsCronSlugs() {
  return (
    process.env.CRON_SMS_DRAIN_ON ||
    "loan-reminder,reconciliation,group-health,monthly-group-repayment"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function purgeSmsBeforeCron(jobSlug) {
  const onVercel =
    process.env.VERCEL === "1" ||
    process.env.VERCEL === "true" ||
    process.env.IZI_RUNTIME === "vercel";
  if (!onVercel || process.env.CRON_SMS_PURGE_PENDING === "false") {
    return { skipped: true, reason: "SMS purge disabled or not on Vercel" };
  }
  const allowed =
    process.env.CRON_SMS_PURGE_ON?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) || smsCronSlugs();
  if (!allowed.includes(jobSlug)) {
    return {
      skipped: true,
      reason: "SMS purge only on: " + allowed.join(", "),
    };
  }
  const {
    purgeOutstandingSmsBeforeCron,
  } = require("../../functions/utils/clearSmsQueue");
  console.log(`[SMS_PURGE] Before cron job="${jobSlug}"`);
  return purgeOutstandingSmsBeforeCron();
}

async function drainSmsAfterCron(jobSlug) {
  const onVercel =
    process.env.VERCEL === "1" ||
    process.env.VERCEL === "true" ||
    process.env.IZI_RUNTIME === "vercel";
  if (!onVercel || process.env.CRON_SMS_DRAIN === "false") {
    return null;
  }
  const allowed = smsCronSlugs();
  if (!allowed.includes(jobSlug)) {
    console.warn(
      `[SMS_DRAIN] Skipped for job="${jobSlug}" (CRON_SMS_DRAIN_ON=${allowed.join(",")}). ` +
        "Pending rows in sms_queue will not be sent until a drain job runs."
    );
    return {
      skipped: true,
      reason: "SMS drain runs only on: " + allowed.join(", "),
    };
  }
  const { drainSmsQueueForServerless } = require("../../functions/utils/sms");
  const limitByJob = {
    "loan-reminder": parseInt(
      process.env.CRON_SMS_DRAIN_LIMIT_LOAN_REMINDER || "60",
      10
    ),
    "group-health": parseInt(
      process.env.CRON_SMS_DRAIN_LIMIT_GROUP_HEALTH || "40",
      10
    ),
  };
  const limit = limitByJob[jobSlug];
  console.log(`[SMS_DRAIN] Running after cron job="${jobSlug}"${limit ? ` limit=${limit}` : ""}`);
  return drainSmsQueueForServerless(limit ? { limit } : {});
}

module.exports = async (req, res) => {
  if (bootError) {
    res.status(500).json({
      error: "Cron handler failed to load",
      detail: bootError.message,
    });
    return;
  }

  if (!(await authorizeCron(req, res))) return;

  const job = resolveJobSlug(req);
  const handler = job ? jobs[job] : null;

  if (!handler) {
    res.status(404).json({
      error: "Unknown cron job",
      job,
      available: Object.keys(jobs),
    });
    return;
  }

  try {
    await ensureInit();
    let smsPurge = null;
    try {
      smsPurge = await purgeSmsBeforeCron(job);
    } catch (purgeErr) {
      console.error(`[SMS_PURGE] Cron ${job} pre-purge error:`, purgeErr.message);
      smsPurge = { error: purgeErr.message };
    }
    const result = await handler();
    let smsDrain = null;
    try {
      smsDrain = await drainSmsAfterCron(job);
    } catch (drainErr) {
      console.error(`[SMS_DRAIN] Cron ${job} post-drain error:`, drainErr.message);
      smsDrain = { error: drainErr.message };
    }
    res.status(200).json({ ...result, smsPurge, smsDrain });
  } catch (err) {
    console.error(`Cron job ${job} failed:`, err);
    res.status(500).json({ error: err.message, job });
  }
};