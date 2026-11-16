/**
 * Scheduled jobs invoked by Upstash QStash (primary on Vercel).
 * Optional: Bearer CRON_SECRET for manual runs. Firebase onSchedule unchanged.
 */
const path = require("path");

if (!process.env.VERCEL) {
  require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
}

const { initializeApp } = require("../../functions/app");
const { buildConfigFromEnv } = require("../../functions/config/buildConfigFromEnv");
const { authorizeCron, resolveJobSlug } = require("./authorize");

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
  "lender-cron-test": async () => {
    const { runLenderCronTest } = require("../../functions/utils/cron/lenderCronTest");
    return runLenderCronTest();
  },
};

module.exports = async (req, res) => {
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
    const result = await handler();
    res.status(200).json(result);
  } catch (err) {
    console.error(`Cron job ${job} failed:`, err);
    res.status(500).json({ error: err.message, job });
  }
};