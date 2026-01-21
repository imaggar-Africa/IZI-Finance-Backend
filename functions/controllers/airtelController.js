const { sendAirtelMoney } = require("../payment/airtel/airtelSend");

/**
 * Send money via Airtel Money
 */
const sendAirtel = async (req, res) => {
  try {
    const msisdn = req.body.msisdn || req.body.phone;
    const { amount, reference } = req.body;

    if (!msisdn || !amount || !reference) {
      return res.status(400).json({
        success: false,
        message: "msisdn (or phone), amount, reference are required",
      });
    }

    const result = await sendAirtelMoney({
      msisdn,
      amount,
      reference,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Airtel Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Airtel payment failed",
    });
  }
};

const airtelCallback = async (req, res) => {
  try {
    console.log("📥 Airtel Callback Received:", JSON.stringify(req.body));

    /**
     * Expected Airtel callback format (sandbox & prod):
     * {
     *   "transaction": {
     *     "id": "AIRTEL_TXN_1001",
     *     "status": "SUCCESS",
     *     "amount": 50000,
     *     "currency": "UGX"
     *   }
     * }
     */

    const transaction = req.body.transaction;

    if (!transaction || !transaction.id) {
      return res.status(400).json({
        success: false,
        message: "Invalid Airtel callback payload",
      });
    }

    const reference = transaction.id;
    const status = transaction.status;

    // 🔁 STATUS NORMALIZATION
    let finalStatus = "PENDING";

    if (status === "SUCCESS") finalStatus = "SUCCESS";
    if (status === "FAILED") finalStatus = "FAILED";
    if (status === "REVERSED") finalStatus = "REVERSED";

    // TODO (next step):
    // - Find transaction by reference
    // - Update DB status
    // - Credit wallet / close loan / mark repayment

    console.log(`✅ Airtel TXN ${reference} => ${finalStatus}`);

    // Airtel expects 200 OK
    return res.status(200).json({
      success: true,
      message: "Callback received",
    });
  } catch (error) {
    console.error("🔥 Airtel Callback Error:", error);

    // Airtel will retry if not 200
    return res.status(500).json({
      success: false,
      message: "Callback processing failed",
    });
  }
};
module.exports = {
  sendAirtel,
  airtelCallback
};
