// controllers/mpesaAccountBalanceCallback.js
const PaybillBalance = require("../models/PaybillBalance");

exports.accountBalanceCallback = async (req, res) => {
  try {
    const params =
      req.body?.Result?.ResultParameters?.ResultParameter || [];

    const balanceParam = params.find(
      p => p.Key === "AccountBalance"
    );

    // MPESA expects success ACK even if data is missing
    if (!balanceParam || !balanceParam.Value) {
      return res.json({ ResultCode: 0 });
    }

    // Example: "Working Account|KES|1250000.00"
    const balance = Number(balanceParam.Value.split("|")[2]);

    if (Number.isNaN(balance)) {
      console.error("Invalid balance format:", balanceParam.Value);
      return res.json({ ResultCode: 0 });
    }

    await PaybillBalance.findOneAndUpdate(
      { shortcode: global.config.mpesaB2cShortcode },
      {
        shortcode: global.config.mpesaB2cShortcode, // ✅ REQUIRED
        availableBalance: balance,
        lastUpdatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    return res.json({ ResultCode: 0 });

  } catch (error) {
    console.error("Account Balance Callback Error:", error);
    return res.json({ ResultCode: 0 });
  }
};
