const axios = require("axios");
const { getAirtelAccessToken } = require("./airtelAuth");

const AIRTEL_BASE_URL = process.env.AIRTEL_BASE_URL;

/**
 * Send Airtel Money
 * @param {Object} params
 * @param {string} params.msisdn
 * @param {number} params.amount
 * @param {string} params.reference
 */
const sendAirtelMoney = async ({ msisdn, amount, reference }) => {
  /**
   * 🔴 SANDBOX / LOCAL MODE (MOCK)
   * Airtel OAuth does NOT work from localhost
   */
  if (process.env.AIRTEL_ENV === "SANDBOX") {
    console.log("⚠️ Airtel MOCK mode enabled");

    return {
      success: true,
      provider: "airtel",
      message: "Airtel payment initiated (MOCK)",
      referenceId: `MOCK-AIRTEL-${Date.now()}`,
      data: {
        status: "PENDING",
        msisdn,
        amount,
        currency: "UGX",
      },
    };
  }

  /**
   * 🟢 PRODUCTION MODE (REAL AIRTEL)
   */
  try {
    // 1️⃣ Get OAuth token
    const accessToken = await getAirtelAccessToken();

    // 2️⃣ Endpoint
    const url = `${AIRTEL_BASE_URL}/standard/v1/payments/`;

    // 3️⃣ Payload
    const payload = {
      reference,
      subscriber: {
        country: "UG",
        currency: "UGX",
        msisdn,
      },
      transaction: {
        amount: amount.toString(),
        id: reference,
      },
    };

    // 4️⃣ Headers
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Country": "UG",
      "X-Currency": "UGX",
    };

    // 5️⃣ API call
    const response = await axios.post(url, payload, {
      headers,
      timeout: 15000,
    });

    return {
      success: true,
      provider: "airtel",
      data: response.data,
    };
  } catch (error) {
    console.error(
      "❌ Airtel Send Money Error:",
      error.response?.data || error.message
    );

    return {
      success: false,
      provider: "airtel",
      error: error.response?.data || error.message,
    };
  }
};

module.exports = { sendAirtelMoney };
