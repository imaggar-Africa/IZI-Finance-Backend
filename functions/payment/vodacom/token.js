const axios = require("axios");

async function getVodacomToken() {
  const auth = Buffer.from(
    `${process.env.VODACOM_MPESA_CONSUMER_KEY}:${process.env.VODACOM_MPESA_CONSUMER_SECRET}`
  ).toString("base64");

  const { data } = await axios.get(
    `${process.env.VODACOM_MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: {
        Authorization: `Basic ${auth}`
      }
    }
  );

  return data.access_token;
}

module.exports = getVodacomToken;
