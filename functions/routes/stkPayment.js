const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");
const Transaction = require("../models/Transaction");
const { initiateSTKPush } = require("../utils/mpesa");

// Payment page → STK Push
router.post("/pay/stk", async (req, res) => {
  try {
    const { accountId, amount } = req.body;
    console.log("🔥 BODY:", req.body);

    if (!accountId || !amount || Number(amount) <= 0) {
      return res.status(400).send("Invalid payment data");
    }

    const borrower = await Customer.findOne({ accountId });
    if (!borrower) {
      return res.send("Invalid account ID");
    }

    const phone = borrower.phone; // always from DB

    // 1️⃣ Create pending transaction
    const transaction = await Transaction.create({
      type: "customer deposit",
      userId: borrower._id,
      userModel: "Customer",
      phone,
      amount: Number(amount),
      accountReference: accountId,
      status: "pending"
    });

    // 2️⃣ Initiate STK push
    const stkResponse = await initiateSTKPush(
      phone,
      Number(amount),
      accountId
    );

    // 3️⃣ SAVE IDs for callback matching (VERY IMPORTANT)
    transaction.checkoutRequestID = stkResponse.CheckoutRequestID;
    transaction.merchantRequestID = stkResponse.MerchantRequestID;
    await transaction.save();

    res.send(`
      <h3>Payment Request Sent</h3>
      <p>Please check your phone and enter your M-Pesa PIN.</p>
    `);

  } catch (err) {
    console.error("STK ERROR:", err);
    res.status(500).send("Failed to initiate payment");
  }
});


module.exports = router;
