const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");
const Transaction = require("../models/Transaction");
const { initiateSTKPush } = require("../utils/mpesa");

// Payment page → STK Push
router.post("/pay/stk", async (req, res) => {
  try {
    const { accountId, amount, phone } = req.body;

    const borrower = await Customer.findOne({ accountId });
    if (!borrower) {
      return res.send("Invalid account ID");
    }

    // Create pending transaction (wallet / savings)
    const transaction = await Transaction.create({
      type: "customer deposit",
      userId: borrower._id,
      userModel: "Customer",
      phone,
      amount,
      accountReference: accountId,
      status: "pending"
    });

    // Send STK Push
    await initiateSTKPush(phone, amount, accountId);

    res.send(`
      <h3>Payment Request Sent</h3>
      <p>Please check your phone and enter your M-Pesa PIN.</p>
    `);

  } catch (err) {
    res.status(500).send("Failed to initiate payment");
  }
});

module.exports = router;
