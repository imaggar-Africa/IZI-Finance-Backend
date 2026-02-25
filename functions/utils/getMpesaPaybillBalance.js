// utils/getMpesaPaybillBalance.js

const PaybillBalance = require("../models/PaybillBalance");

exports.getMpesaPaybillBalance = async () => {
  if (!global.config) {
    throw new Error("Global config not initialized");
  }

  const record = await PaybillBalance.findOne({
    shortcode: global.config.mpesaB2cShortcode
  });

  if (!record) {
    throw new Error("Paybill balance not available");
  }

  // ✅ Freshness check (recommended)
  const age = Date.now() - record.lastUpdatedAt.getTime();
  if (age > 10 * 60 * 1000) {
    throw new Error("Paybill balance outdated. Try again shortly.");
  }

  return record.availableBalance;
};
