const SmsQueue = require("../models/SmsQueue");

function buildStatusFilter(includeFailed) {
  const statuses = ["Pending", "Waiting for Balance", "Processing"];
  if (includeFailed) statuses.push("Failed");
  return { status: { $in: statuses } };
}

/**
 * @param {{ dryRun?: boolean, includeFailed?: boolean }} options
 */
async function clearStaleSmsQueue(options = {}) {
  const { dryRun = false, includeFailed = false } = options;
  const filter = buildStatusFilter(includeFailed);

  const toClear = await SmsQueue.countDocuments(filter);

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      wouldDelete: toClear,
      filter,
    };
  }

  const result = await SmsQueue.deleteMany(filter);
  return {
    ok: true,
    dryRun: false,
    deleted: result.deletedCount,
    filter,
  };
}

/**
 * Before a Vercel cron run: drop stuck outbound SMS rows (never drained / stale Processing).
 * Does not delete Sent. Failed only if includeFailed.
 */
async function purgeOutstandingSmsBeforeCron(options = {}) {
  const includeFailed =
    options.includeFailed ??
    process.env.CRON_SMS_PURGE_INCLUDE_FAILED === "true";
  const filter = buildStatusFilter(includeFailed);

  const maxAgeMin = parseInt(
    process.env.CRON_SMS_PURGE_MAX_AGE_MINUTES || "0",
    10
  );
  if (maxAgeMin > 0) {
    const cutoff = new Date(Date.now() - maxAgeMin * 60 * 1000);
    filter.createdAt = { $lt: cutoff };
  }

  const toClear = await SmsQueue.countDocuments(filter);
  if (toClear === 0) {
    return { ok: true, deleted: 0, filter };
  }

  const result = await SmsQueue.deleteMany(filter);
  console.log("[SMS_PURGE] cron_start", {
    deleted: result.deletedCount,
    maxAgeMin,
    includeFailed,
  });
  return {
    ok: true,
    deleted: result.deletedCount,
    maxAgeMin,
    includeFailed,
  };
}

module.exports = {
  clearStaleSmsQueue,
  buildStatusFilter,
  purgeOutstandingSmsBeforeCron,
};