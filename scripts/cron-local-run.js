#!/usr/bin/env node
/**
 * Run a Vercel cron handler locally (no `vercel dev` / login).
 * Uses CRON_SECRET from .env if set.
 *
 *   npm run cron:local -- group-health
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const job = process.argv[2];
const allowed = [
  "loan-reminder",
  "reconciliation",
  "group-health",
  "monthly-group-repayment",
  "credit-score-recovery",
];

if (!job || !allowed.includes(job)) {
  console.error("Usage: npm run cron:local -- <job>");
  console.error("Jobs:", allowed.join(", "));
  process.exit(1);
}

const handler = require(path.join(__dirname, "..", "api", "cron", "[job].js"));

const req = {
  method: "POST",
  url: `/api/cron/${job}`,
  query: { job },
  headers: {},
};

const secret = process.env.CRON_SECRET?.trim();
if (secret) {
  req.headers.authorization = `Bearer ${secret}`;
} else {
  console.warn(
    "No CRON_SECRET in .env — set it or the handler will return 401 unless you use QStash signing."
  );
}

let exitCode = 0;
const res = {
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    if (this.statusCode >= 400) exitCode = 1;
    console.log(JSON.stringify(body, null, 2));
  },
};

handler(req, res)
  .then(() => process.exit(exitCode))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });