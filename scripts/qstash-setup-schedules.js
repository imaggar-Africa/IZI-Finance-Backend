#!/usr/bin/env node
/**
 * Create or update QStash schedules that POST to Vercel api/cron/{job}.
 * Requires QSTASH_TOKEN. Reads CRON_BASE_URL from env (see QSTASH.md).
 *   npm run qstash:schedules              — ensure 5 jobs exist
 *   npm run qstash:schedules -- --force   — recreate each job
 *   npm run qstash:reset                  — delete ALL schedules on this token, then create 5
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { Client } = require("@upstash/qstash");

const DEFAULT_BASE = "https://vercel-izi-finance-backend.vercel.app";

/** Production crons (Africa/Nairobi) — matches functions/index.js onSchedule */
const NAIROBI = "CRON_TZ=Africa/Nairobi";

const JOB_SCHEDULES = [
  { slug: "loan-reminder", cron: `${NAIROBI} 0 18 * * *` },
  { slug: "reconciliation", cron: `${NAIROBI} 0 18 * * *` },
  { slug: "group-health", cron: `${NAIROBI} 0 0 1 * *` },
  { slug: "monthly-group-repayment", cron: `${NAIROBI} 0 1 1 * *` },
  { slug: "credit-score-recovery", cron: `${NAIROBI} 0 0 1 * *` },
];

/** Slugs removed from QStash — deleted on each `npm run qstash:schedules` run. */
const REMOVED_SLUGS = ["lender-cron-test"];

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
  const wipeAll = process.argv.includes("--wipe-all");
  const force = process.argv.includes("--force") || wipeAll;

  let existing = [];
  try {
    existing = await client.schedules.list();
  } catch (err) {
    console.error("Failed to list schedules:", err.message);
    process.exit(1);
  }

  if (wipeAll && existing.length) {
    console.log(`Wiping ${existing.length} schedule(s) on this QStash project…`);
    for (const s of existing) {
      await client.schedules.delete(s.scheduleId);
      console.log(`DEL ${s.scheduleId} → ${s.destination}`);
    }
    existing = [];
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

  for (const slug of REMOVED_SLUGS) {
    const dest = destination(base, slug);
    const found = byDest.get(dest);
    if (found) {
      await client.schedules.delete(found.scheduleId);
      console.log(`DEL ${slug} (removed from QStash, id ${found.scheduleId})`);
    }
  }

  const allowedDests = new Set([
    ...JOB_SCHEDULES.map((j) => destination(base, j.slug)),
    ...REMOVED_SLUGS.map((s) => destination(base, s)),
  ]);
  const orphans = (existing || []).filter(
    (s) =>
      !allowedDests.has(s.destination) ||
      !String(s.destination || "").startsWith(base + "/")
  );
  if (orphans.length) {
    console.warn(`\nOrphan schedules (${orphans.length}) — old projects or duplicates:`);
    for (const s of orphans) {
      console.warn(`  ${s.scheduleId} → ${s.destination}`);
      if (process.argv.includes("--prune-orphans")) {
        await client.schedules.delete(s.scheduleId);
        console.log(`DEL orphan ${s.scheduleId}`);
      }
    }
    if (!process.argv.includes("--prune-orphans")) {
      console.warn("Run: npm run qstash:schedules -- --prune-orphans");
    }
  }

  console.log("\nDone. Set on Vercel (Production):");
  console.log("  QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY, CRON_BASE_URL=" + base);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});