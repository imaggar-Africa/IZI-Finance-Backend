const Customer = require("../models/customer");
const Loan = require("../models/Loan");
const GroupMember = require("../models/GroupMember");
const { normalizePhone } = require("./normalizePhone");

/**
 * Paybill "Account Number" must be the borrower's National ID (idNumber), not the paybill shortcode.
 */
async function resolveCustomerFromC2b(billRef, msisdn, session) {
  const ref = String(billRef || "").trim();
  const shortcode = String(global.config?.mpesaShortcode || "").trim();
  const q = (filter) =>
    session
      ? Customer.findOne(filter).session(session)
      : Customer.findOne(filter);

  if (ref) {
    const byId = await q({ idNumber: ref });
    if (byId) return { customer: byId, matchedBy: "idNumber" };

  }

  if (ref && shortcode && ref === shortcode) {
    console.warn("[C2B_RESOLVE] paybill_shortcode_used_as_account", {
      billRef: ref,
      hint: "User must enter National ID as account number, not paybill number",
    });
  }

  const rawMsisdn = msisdn || "";
  if (rawMsisdn) {
    const phone = normalizePhone(rawMsisdn);
    if (phone) {
      const byPhone = await q({ phone });
      if (byPhone) return { customer: byPhone, matchedBy: "phone" };
    }
  }

  return { customer: null, matchedBy: null };
}

async function resolveActiveLoanForCustomer(customer, billRef, session) {
  const ref = String(billRef || "").trim();
  const baseFilter = {
    borrowerId: customer._id,
    status: { $in: ["active", "overdue"] },
    loanRequestStatus: { $ne: "processing" },
  };
  const q = (filter) =>
    session ? Loan.findOne(filter).session(session) : Loan.findOne(filter);

  if (ref) {
    const exact = await q({ ...baseFilter, billRefNumber: ref });
    if (exact) return exact;
  }

  const loans = await (session
    ? Loan.find(baseFilter).sort({ updatedAt: -1 }).limit(2).session(session)
    : Loan.find(baseFilter).sort({ updatedAt: -1 }).limit(2));

  if (loans.length === 1) {
    const loan = loans[0];
    if (!loan.billRefNumber && ref) {
      loan.billRefNumber = ref;
    } else if (!loan.billRefNumber && customer.idNumber) {
      loan.billRefNumber = customer.idNumber;
    }
    return loan;
  }

  if (loans.length > 1 && ref) {
    const withRef = loans.find((l) => l.billRefNumber === ref);
    if (withRef) return withRef;
  }

  return loans[0] || null;
}

async function resolveGroupMember(customer, session) {
  const filter = {
    borrowerId: customer._id,
    remaining_balance: { $gt: 0 },
  };
  return session
    ? GroupMember.findOne(filter).session(session)
    : GroupMember.findOne(filter);
}

/** Vercel production C2B callbacks (fallback when env URLs not set). */
const C2B_DEFAULT_VALIDATE_URL =
  "https://vercel-izi-finance-backend.vercel.app/api/c2b/validate";
const C2B_DEFAULT_CONFIRM_URL =
  "https://vercel-izi-finance-backend.vercel.app/api/c2b/confirm";

/**
 * C2B Validation/Confirmation URLs for Safaricom Register URL API.
 * 1) MPESA_VALIDATE_URL + MPESA_CONFIRM_URL (global.config / env)
 * 2) else CRON_BASE_URL or PUBLIC_API_BASE_URL + /api/c2b/*
 * 3) else hardcoded Vercel defaults above (never Firebase).
 */
function resolveC2bCallbackUrls(config = global.config, baseOverride) {
  let validateUrl = (config?.mpesaC2bValidateUrl || "").trim();
  let confirmUrl = (config?.mpesaC2bConfirmUrl || "").trim();
  let source = "hardcoded_vercel_default";

  if (validateUrl && confirmUrl) {
    return { validateUrl, confirmUrl, source: "env_mpesa_urls" };
  }

  const base = (baseOverride ||
    process.env.CRON_BASE_URL ||
    process.env.PUBLIC_API_BASE_URL ||
    "")
    .trim()
    .replace(/\/$/, "");

  if (base.startsWith("http")) {
    source = baseOverride ? "cli_base" : "env_public_base";
    if (!validateUrl) validateUrl = `${base}/api/c2b/validate`;
    if (!confirmUrl) confirmUrl = `${base}/api/c2b/confirm`;
    return { validateUrl, confirmUrl, source };
  }

  if (!validateUrl) validateUrl = C2B_DEFAULT_VALIDATE_URL;
  if (!confirmUrl) confirmUrl = C2B_DEFAULT_CONFIRM_URL;
  return { validateUrl, confirmUrl, source };
}

module.exports = {
  resolveCustomerFromC2b,
  resolveActiveLoanForCustomer,
  resolveGroupMember,
  resolveC2bCallbackUrls,
  C2B_DEFAULT_VALIDATE_URL,
  C2B_DEFAULT_CONFIRM_URL,
};