const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");

// QR scan → payment page
router.get("/pay/:accountId", async (req, res) => {
  try {
    const { accountId } = req.params;

    const borrower = await Customer.findOne({ accountId });
    if (!borrower) {
      return res.status(404).send("Invalid account ID");
    }

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>iziFinance Payment</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        </head>
        <body style="font-family: Arial; padding:20px">
          <h2>Pay to ${borrower.fullName}</h2>
          <p>Account ID: <b>${accountId}</b></p>

          <form method="POST" action="/api/pay/stk">
            <input type="hidden" name="accountId" value="${accountId}" />

            <label>Amount</label><br/>
            <input type="number" name="amount" required /><br/><br/>

            <label>Phone Number</label><br/>
            <input type="text" name="phone" placeholder="2547XXXXXXXX" required /><br/><br/>

            <button type="submit">Pay Now</button>
          </form>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send("Server error");
  }
});

module.exports = router;
