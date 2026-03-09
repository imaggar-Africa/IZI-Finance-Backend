const { sendSMS } = require("../utils/sms");

exports.testSMS = async (req, res) => {
  const { phone } = req.body;

  const result = await sendSMS(
    phone,
    "Hello from BullMQ"
  );

  res.json(result);
};