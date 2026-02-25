// utils/requestPaybillBalance.js
const axios = require("axios");
const { getAccessToken } = require("./mpesa"); // your existing token function

exports.requestPaybillBalance = async () => {
  if (!global.config) {
    throw new Error("Global config not initialized");
  }

  const token = await getAccessToken();

  const baseUrl =
    global.config.mpesaEnv === "live"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";

  const url = `${baseUrl}/mpesa/accountbalance/v1/query`;

const payload = {
  Initiator: global.config.mpesaB2cInitiator,
  SecurityCredential: global.config.mpesaB2cCredential,
  CommandID: "AccountBalance",
  PartyA: global.config.mpesaB2cShortcode,
  IdentifierType: "4",
  Remarks: "Paybill balance check",
  QueueTimeOutURL: global.config.mpesaB2cTimeoutUrl,
  ResultURL: global.config.mpesaAccountBalanceResultUrl // ✅
};


  await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    timeout: 15000
  });
};
