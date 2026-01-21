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

// const mtnCallback = async (req, res) => {
//   try {
//     const { referenceId, status } = req.body;

//     const transaction = await Transaction.findOne({ reference: referenceId });
//     if (!transaction) return res.json({ success: true });

//     if (status === "SUCCESS") {
//       transaction.status = "successful";

//       if (transaction.loanId) {
//         const loan = await Loan.findById(transaction.loanId);
//         loan.repaidAmount += transaction.amount;
//         loan.balance -= transaction.amount;
//         loan.status = loan.balance <= 0 ? "fully paid" : "active";
//         await loan.save();
//       }
//     } else {
//       transaction.status = "failed";
//     }

//     await transaction.save();
//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).json({ success: false });
//   }
// };

module.exports = { sendMtn};
