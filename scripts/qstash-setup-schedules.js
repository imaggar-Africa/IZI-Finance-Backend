#!/usr/bin/env node
/**
 * Create or update QStash schedules that POST to Vercel api/cron/{job}.
 * Requires QSTASH_TOKEN. Reads CRON_BASE_URL from env (see QSTASH.md).
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { Client } = require("@upstash/qstash");

const DEFAULT_BASE = "https://vercel-izi-finance-backend.vercel.app";

const JOB_SCHEDULES = [
  {
    slug: "loan-reminder",
    cron: "CRON_TZ=Africa/Nairobi 0 18 * * *",
  },
  {
    slug: "reconciliation",
    cron: "CRON_TZ=Africa/Nairobi 15 18 * * *",
  },
  {
    slug: "group-health",
    cron: "CRON_TZ=Africa/Nairobi 0 0 1 * *",
  },
  {
    slug: "monthly-group-repayment",
    cron: "CRON_TZ=Africa/Nairobi 0 1 1 * *",
  },
  {
    slug: "credit-score-recovery",
    cron: "CRON_TZ=Africa/Nairobi 30 0 1 * *",
  },
  {
    slug: "lender-cron-test",
    cron: "CRON_TZ=Africa/Nairobi */5 * * * *",
  },
];

function destination(base, slug) {
  return `${base}/api/cron/${slug}`;
}

async function main() {
  const token = process.env.QSTASH_TOKEN?.trim();
  if (!token) {
    console.error("Missing QSTASH_TOKEN. Get it from Upstash Console → QStash.");
    process.exit(1);
  }

  const base = (process.env.CRON_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  const qstashUrl = process.env.QSTASH_URL?.trim();
  const client = new Client({
    token,
    ...(qstashUrl ? { baseUrl: qstashUrl } : {}),
  });
  const force = process.argv.includes("--force");

  let existing = [];
  try {
    existing = await client.schedules.list();
  } catch (err) {
    console.error("Failed to list schedules:", err.message);
    process.exit(1);
  }

  const byDest = new Map(
    (existing || []).map((s) => [s.destination, s])
  );

  for (const job of JOB_SCHEDULES) {
    const dest = destination(base, job.slug);
    const found = byDest.get(dest);

    if (found && !force) {
      console.log(`OK  ${job.slug} (already scheduled → ${dest}, id ${found.scheduleId})`);
      continue;
    }

    if (found && force) {
      await client.schedules.delete(found.scheduleId);
      console.log(`DEL ${job.slug} (${found.scheduleId})`);
    }

    const created = await client.schedules.create({
      destination: dest,
      cron: job.cron,
      method: "POST",
      retries: 3,
    });

    console.log(`ADD ${job.slug} cron=${job.cron} id=${created.scheduleId} → ${dest}`);
  }

  console.log("\nDone. Set on Vercel (Production):");
  console.log("  QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY, CRON_BASE_URL=" + base);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});