const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");
const Transaction = require("../models/Transaction");
const { initiateSTKPush } = require("../utils/mpesa");

// Payment page → STK Push
router.post("/pay/stk", async (req, res) => {
  try {
    const { accountId, amount, phone } = req.body;

    if (!accountId || !amount || Number(amount) <= 0 || !phone) {
      return res.status(400).send("Invalid payment data");
    }

    const borrower = await Customer.findOne({ accountId });
    if (!borrower) {
      return res.status(404).send("Invalid account ID");
    }

    // phone = CUSTOMER phone
    const transaction = await Transaction.create({
      type: "customer payment",
      userId: borrower._id,
      userModel: "Customer",
      phone: phone,                 // ✅ only phone
      amount: Number(amount),
      accountReference: accountId,
      status: "pending"
    });

    const stkResponse = await initiateSTKPush(
      phone,                        // STK popup → customer phone
      Number(amount),
      accountId
    );

    transaction.checkoutRequestID = stkResponse.CheckoutRequestID;
    transaction.merchantRequestID = stkResponse.MerchantRequestID;
    await transaction.save();

    res.send(`
      <h3>Payment Request Sent</h3>
      <p>Please check your phone and enter your M-Pesa PIN.</p>
    `);

  } catch (err) {
    console.error("❌ STK payment route failed:", err);
    res.status(500).send(`Failed to initiate payment: ${err.message}`);
  }
});


module.exports = router;
