const axios = require("axios");
const moment = require("moment");
const getVodacomToken = require("./token");

async function vodacomSTKPush({ phone, amount, reference, description }) {
  const token = await getVodacomToken();

  const timestamp = moment().format("YYYYMMDDHHmmss");
  const password = Buffer.from(
    `${process.env.VODACOM_MPESA_SHORTCODE}${process.env.VODACOM_MPESA_PASSKEY}${timestamp}`
  ).toString("base64");

  const payload = {
    BusinessShortCode: process.env.VODACOM_MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: amount,
    PartyA: phone,
    PartyB: process.env.VODACOM_MPESA_SHORTCODE,
    PhoneNumber: phone,
    CallBackURL: process.env.VODACOM_MPESA_CALLBACK_URL,
    AccountReference: reference,
    TransactionDesc: description
  };

  const { data } = await axios.post(
    `${process.env.VODACOM_MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  return data;
}

module.exports = vodacomSTKPush;
