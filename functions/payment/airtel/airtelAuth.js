const axios = require("axios");
const qs = require("qs");

/**
 * Airtel Money Sandbox - OAuth Token
 */
const getAirtelAccessToken = async () => {
  try {
    const url = `${process.env.AIRTEL_BASE_URL}/auth/oauth2/token`;

    const payload = qs.stringify({
      client_id: process.env.AIRTEL_CLIENT_ID,
      client_secret: process.env.AIRTEL_CLIENT_SECRET,
      grant_type: "client_credentials",
    });

    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 10000,
    });

    return response.data.access_token;
  } catch (error) {
    console.error(
      "Airtel OAuth Error:",
      error.response?.data || error.message
    );
    throw new Error("Airtel OAuth failed");
  }
};

module.exports = {
  getAirtelAccessToken,
};
