const User = require("../../models/User");
const { sendSMS } = require("../../utils/sms");
const { normalizePhone } = require("../../utils/normalizePhone");

/**
 * QStash/Vercel smoke test: SMS lenders only (not borrowers).
 * Set CRON_TEST_SMS=true to send. Optional CRON_TEST_LENDER_PHONES=+254...,+254...
 */
async function runLenderCronTest() {
  const job = "lender-cron-test";

  if (process.env.CRON_TEST_SMS !== "true") {
    return {
      ok: true,
      job,
      dryRun: true,
      hint: "Set CRON_TEST_SMS=true on Vercel (or .env) to send real SMS to lenders.",
    };
  }

  const allowRaw = process.env.CRON_TEST_LENDER_PHONES?.trim();
  const allowList = allowRaw
    ? allowRaw
        .split(/[,;\s]+/)
        .map((p) => normalizePhone(p))
        .filter(Boolean)
    : [];

  const lenders = await User.find({ role: "lender" }).select("phone name").lean();
  const seen = new Set();
  const targets = [];

  for (const lender of lenders) {
    const phone = normalizePhone(lender.phone);
    if (!phone || seen.has(phone)) continue;
    if (allowList.length && !allowList.includes(phone)) continue;
    seen.add(phone);
    targets.push({ phone, name: lender.name || "Lender" });
  }

  if (!targets.length) {
    return {
      ok: true,
      job,
      sent: 0,
      message: allowList.length
        ? "No lenders matched CRON_TEST_LENDER_PHONES."
        : "No lenders with valid phones found.",
    };
  }

  const when = new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
  let sent = 0;
  const errors = [];

  for (const { phone, name } of targets) {
    const text = `IziFinance cron test\nHi ${name}, this is a scheduled job test (lender-cron-test) at ${when} EAT. No borrower action needed.`;
    try {
      await sendSMS(phone, text);
      sent++;
    } catch (err) {
      errors.push({ phone, error: err.message });
    }
  }

  return {
    ok: errors.length === 0,
    job,
    sent,
    lenderCount: targets.length,
    errors: errors.length ? errors : undefined,
  };
}

module.exports = { runLenderCronTest };