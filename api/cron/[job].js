/**
 * Vercel Cron targets (see vercel.json). Firebase scheduled jobs are unchanged.
 * Set CRON_SECRET in Vercel env; Vercel sends Authorization: Bearer <CRON_SECRET>.
 */
const path = require("path");

if (!process.env.VERCEL) {
  require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
}

const { initializeApp } = require("../../functions/app");
const { buildConfigFromEnv } = require("../../functions/config/buildConfigFromEnv");

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

function authorizeCron(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    res.status(503).json({
      error: "CRON_SECRET is not configured",
    });
    return false;
  }
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
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

module.exports = async (req, res) => {
  if (!authorizeCron(req, res)) return;

  const job = req.query.job;
  const handler = jobs[job];

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
    const result = await handler();
    res.status(200).json(result);
  } catch (err) {
    console.error(`❌ Cron job ${job} failed:`, err);
    res.status(500).json({ error: err.message, job });
  }
};
