const axios = require("axios");
const { normalizePhone } = require("./normalizePhone");

/* ---------------- CONFIG HELPERS ---------------- */

function getConfig() {
  if (!global.config) {
    throw new Error(
      "❌ global.config not initialized. Make sure initializeApp() runs first."
    );
  }
  return global.config;
}

function getBaseURL() {
  const env = getConfig().mpesaEnv.trim().toLowerCase();
  return env === "sandbox"
    ? "https://sandbox.safaricom.co.ke"
    : "https://api.safaricom.co.ke";
}

/* ---------------- ACCESS TOKEN ---------------- */

async function getAccessToken() {
  const config = getConfig();

  const auth = Buffer.from(
    `${config.mpesaConsumerKey.trim()}:${config.mpesaConsumerSecret.trim()}`
  ).toString("base64");

  const { data } = await axios.get(
    `${getBaseURL()}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  return data.access_token;
}

/* ---------------- HELPERS ---------------- */

function timestamp14() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function stkPassword(shortcode, passkey, ts) {
  return Buffer.from(`${shortcode}${passkey}${ts}`).toString("base64");
}

/* ---------------- STK PUSH ---------------- */

async function initiateSTKPush(phoneNumber, amount, accountRef) {
  const config = getConfig();
  const env = config.mpesaEnv.trim().toLowerCase();

  const normalized = normalizePhone(phoneNumber);
  if (!normalized) {
    throw new Error("Invalid phone number");
  }

  // M-Pesa requires MSISDN without "+"
  const phone = normalized.replace("+", "");

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 1) {
    throw new Error("Invalid amount");
  }

  // Sandbox restriction
  if (env === "sandbox" && phone !== "254708374149") {
    throw new Error("Sandbox MSISDN must be 254708374149");
  }

  const token = await getAccessToken();
  const ts = timestamp14();
  const password = stkPassword(
    config.mpesaShortcode.trim(),
    config.mpesaPasskey.trim(),
    ts
  );

  const { data } = await axios.post(
    `${getBaseURL()}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: config.mpesaShortcode.trim(),
      Password: password,
      Timestamp: ts,
      TransactionType: "CustomerPayBillOnline",
      Amount: amt,
      PartyA: phone,
      PartyB: config.mpesaShortcode.trim(),
      PhoneNumber: phone,
      CallBackURL: config.mpesaStkCallback.trim(),

      // 🔗 Link payment to loan / wallet
      AccountReference: accountRef || "Loan-Repayment",
      TransactionDesc: "Loan Repayment",
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
}

/* ---------------- STK QUERY ---------------- */

async function querySTK(checkoutRequestID) {
  const config = getConfig();
  const token = await getAccessToken();
  const ts = timestamp14();

  const password = stkPassword(
    config.mpesaShortcode.trim(),
    config.mpesaPasskey.trim(),
    ts
  );

  const { data } = await axios.post(
    `${getBaseURL()}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: config.mpesaShortcode.trim(),
      Password: password,
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestID,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
}

/* ---------------- B2C PAYMENT ---------------- */

async function initiateB2C(phoneNumber, amount) {
  const config = getConfig();

  const normalized = normalizePhone(phoneNumber);
  if (!normalized) {
    throw new Error("Invalid phone number");
  }

  const phone = normalized.replace("+", "");
  const token = await getAccessToken();

  const { data } = await axios.post(
    `${getBaseURL()}/mpesa/b2c/v1/paymentrequest`,
    {
      InitiatorName: config.mpesaB2cInitiator.trim(),
      SecurityCredential: config.mpesaB2cCredential.trim(),
      CommandID: "BusinessPayment",
      Amount: amount,
      PartyA: config.mpesaB2cShortcode.trim(),
      PartyB: phone,
      Remarks: "Loan Disbursement",
      QueueTimeOutURL: config.mpesaB2cTimeoutUrl.trim(),
      ResultURL: config.mpesaB2cResultUrl.trim(),
      Occasion: "Loan Payment",
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
}

/* ---------------- REVERSAL ---------------- */

async function reverseTransaction(transactionId, amount, sender) {
  const config = getConfig();
  const token = await getAccessToken();

  await axios.post(
    config.mpesaReversalUrl.trim(),
    {
      Initiator: config.mpesaB2cInitiator.trim(),
      SecurityCredential: config.mpesaB2cCredential.trim(),
      CommandID: "TransactionReversal",
      TransactionID: transactionId,
      Amount: amount,
      ReceiverParty: sender,
      ReceiverIdentifierType: "1",
      ResultURL: config.mpesaReversalResult.trim(),
      QueueTimeOutURL: config.mpesaReversalTimeout.trim(),
      Remarks: "Reversal",
      Occasion: "Refund",
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

/* ---------------- EXPORTS ---------------- */

module.exports = {
  initiateSTKPush,
  querySTK,
  initiateB2C,
  reverseTransaction,
};
