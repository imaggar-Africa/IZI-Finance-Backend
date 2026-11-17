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

module.exports = { clearStaleSmsQueue, buildStatusFilter };