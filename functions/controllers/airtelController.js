const { sendAirtelMoney } = require("../payment/airtel/airtelSend");
const Transaction = require("../models/Transaction");
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

    const transactionData = req.body.transaction;

    if (!transactionData || !transactionData.id) {
      return res.status(400).json({
        success: false,
        message: "Invalid Airtel callback payload",
      });
    }

    const reference = transactionData.id;
    const status = transactionData.status;

    let finalStatus = "PENDING";
    if (status === "SUCCESS") finalStatus = "SUCCESS";
    if (status === "FAILED") finalStatus = "FAILED";
    if (status === "REVERSED") finalStatus = "REVERSED";

    // 🔹 OPTIONAL DB UPDATE (SAFE)
    const txn = await Transaction.findOne({ referenceId: reference });

    if (txn) {
      txn.status = finalStatus.toLowerCase();
      await txn.save();
    }

    console.log(`✅ Airtel TXN ${reference} => ${finalStatus}`);

    return res.status(200).json({
      success: true,
      message: "Callback received",
    });

  } catch (error) {
    console.error("🔥 Airtel Callback Error:", error);

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
