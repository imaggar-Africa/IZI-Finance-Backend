const QRCode = require("qrcode");

exports.generatePaymentQR = async (accountId) => {
  const url = `https://pay.izifinance.com/pay/${accountId}`;
  return await QRCode.toDataURL(url);
};
