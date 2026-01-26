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

  try {
    phoneNumber = phoneNumber.replace(/^\+/, "").replace(/\s+/g, "");

    amount = Number(amount);
    if (!Number.isFinite(amount) || amount < 1)
      throw new Error("Amount must be >= 1");

    if (env === "sandbox" && phoneNumber !== "254708374149") {
      throw new Error("Sandbox MSISDN must be 254708374149");
    }

    const accessToken = await getAccessToken();
    const ts = timestamp14();
    const password = stkPassword(config.mpesaShortcode, config.mpesaPasskey, ts);


    // 🚀 Log before sending
    console.log("📌 STK Push Request Config:", {
      env,
      BusinessShortCode: config.mpesaShortcode.trim(),
      Passkey: config.mpesaPasskey ? "Loaded ✔" : "Missing ❌",
      CallbackURL: config.mpesaStkCallback.trim(),
      AccountReference: accountRef,
      PhoneNumber: phoneNumber,
      Amount: amount
    });
    
    const { data } = await axios.post(
      `${getBaseURL()}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: config.mpesaShortcode.trim(),
        Password: password,
        Timestamp: ts,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phoneNumber,
        PartyB: config.mpesaShortcode.trim(),
        PhoneNumber: phoneNumber,
        CallBackURL: config.mpesaStkCallback.trim(),

        // ⭐ USE DYNAMIC CUSTOMER ACCOUNT REFERENCE
        AccountReference:
          env === "sandbox"
            ? accountRef || "TEST-STK"
            : accountRef || "CustomerPayment",

        TransactionDesc:
          env === "sandbox"
            ? "TEST MODE — NO REAL DEBIT"
            : "Deposit to Wallet",
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return data;
  } catch (error) {
    console.error("❌ STK Push failed:", error.response?.data || error.message);
    throw new Error("STK Push failed");
  }
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
