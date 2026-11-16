const User = require("../../models/User");
const SmsQueue = require("../../models/SmsQueue");
const { sendSMS, sendSMSDirect } = require("../../utils/sms");
const { normalizePhone } = require("../../utils/normalizePhone");

const LOG = "[lender-cron-test]";

async function collectLenderTargets() {
  const allowRaw = process.env.CRON_TEST_LENDER_PHONES?.trim();
  const allowList = allowRaw
    ? allowRaw
        .split(/[,;\s]+/)
        .map((p) => normalizePhone(p))
        .filter(Boolean)
    : [];

  const lenders = await User.find({
    role: "lender",
    isDeleted: { $ne: true },
  })
    .select("phone name")
    .lean();

  const seen = new Set();
  const targets = [];
  const skipped = [];

  for (const lender of lenders) {
    const phone = normalizePhone(lender.phone);
    const raw = lender.phone || "(empty)";
    if (!phone) {
      skipped.push({ raw, reason: "invalid_phone" });
      continue;
    }
    if (seen.has(phone)) {
      skipped.push({ phone, reason: "duplicate" });
      continue;
    }
    if (allowList.length && !allowList.includes(phone)) {
      skipped.push({ phone, reason: "not_in_CRON_TEST_LENDER_PHONES" });
      continue;
    }
    seen.add(phone);
    targets.push({ phone, name: lender.name || "Lender" });
  }

  return { targets, skipped, allowList, lenderRows: lenders.length };
}

/**
 * QStash/Vercel smoke test: SMS lenders only (not borrowers).
 * Set CRON_TEST_SMS=true to send. Optional CRON_TEST_LENDER_PHONES=+254...,+254...
 * On Vercel, CRON_TEST_SMS_DIRECT=true sends via Africa's Talking (not BullMQ worker).
 */
async function runLenderCronTest() {
  const job = "lender-cron-test";
  const smsEnabled = process.env.CRON_TEST_SMS === "true";
  const directOnVercel =
    process.env.CRON_TEST_SMS_DIRECT === "true" ||
    process.env.VERCEL === "1" ||
    process.env.IZI_RUNTIME === "vercel";

  const { targets, skipped, allowList, lenderRows } = await collectLenderTargets();

  console.log(LOG, {
    CRON_TEST_SMS: smsEnabled,
    CRON_TEST_SMS_DIRECT: directOnVercel,
    lendersInDb: lenderRows,
    targetCount: targets.length,
    targetPhones: targets.map((t) => t.phone),
    skippedCount: skipped.length,
    allowList: allowList.length ? allowList : "(all lenders)",
  });

  if (!smsEnabled) {
    return {
      ok: true,
      job,
      dryRun: true,
      wouldSendTo: targets.map((t) => t.phone),
      lenderCount: targets.length,
      skipped,
      hint: "Set CRON_TEST_SMS=true on Vercel to send. CRON_TEST_SMS_DIRECT=true (or Vercel) uses direct AT send.",
    };
  }

  if (!targets.length) {
    return {
      ok: true,
      job,
      sent: 0,
      sentTo: [],
      message: allowList.length
        ? "No lenders matched CRON_TEST_LENDER_PHONES."
        : "No lenders with valid phones found.",
      skipped,
    };
  }

  const when = new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi" });
  let sent = 0;
  const sentTo = [];
  const queuedTo = [];
  const errors = [];

  for (const { phone, name } of targets) {
    const text = `IziFinance cron test\nHi ${name}, this is a scheduled job test (lender-cron-test) at ${when} EAT. No borrower action needed.`;

    try {
      if (directOnVercel) {
        const smsRecord = await SmsQueue.create({
          phoneNumber: phone,
          message: text,
          status: "Pending",
        });
        await sendSMSDirect(smsRecord);
        sent++;
        sentTo.push(phone);
        console.log(`${LOG} SMS sent (direct) to ${phone}`);
      } else {
        const result = await sendSMS(phone, text);
        if (result?.success) {
          queuedTo.push(phone);
          console.log(`${LOG} SMS queued to ${phone} (smsId: ${result.smsId || "n/a"}) — needs SMS worker`);
        } else {
          errors.push({ phone, error: result?.error || result?.message || "sendSMS failed" });
          console.warn(`${LOG} SMS failed for ${phone}:`, result);
        }
      }
    } catch (err) {
      errors.push({ phone, error: err.message });
      console.error(`${LOG} SMS error for ${phone}:`, err.message);
    }
  }

  return {
    ok: errors.length === 0,
    job,
    sent,
    sentTo,
    queuedTo: queuedTo.length ? queuedTo : undefined,
    lenderCount: targets.length,
    delivery: directOnVercel ? "direct" : "queued",
    errors: errors.length ? errors : undefined,
    skipped: skipped.length ? skipped : undefined,
  };
}

module.exports = { runLenderCronTest };