const { sendMtnMoney } = require("../payment/mtn/mtnSend");

const sendMtn = async (req, res) => {
  try {
    const { msisdn, amount, reference } = req.body;

    if (!msisdn || !amount || !reference) {
      return res.status(400).json({
        success: false,
        message: "msisdn, amount, reference are required"
      });
    }

    const result = await sendMtnMoney({ msisdn, amount, reference });

    return res.json({
      success: true,
      provider: "mtn",
      message: "MTN disbursement initiated",
      referenceId: result.referenceId
    });

  } catch (error) {
    console.error("MTN Error:", error.response?.data || error.message);

    return res.status(400).json({
      success: false,
      provider: "mtn",
      error: error.response?.data || error.message
    });
  }
};

module.exports = { sendMtn };
