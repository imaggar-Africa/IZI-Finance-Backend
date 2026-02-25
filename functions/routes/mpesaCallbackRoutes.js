const express = require("express");
const { stkCallback, reversalResultHandler, reversalTimeoutHandler } = require("../controllers/stkCallbackController");
const { b2cCallback } = require("../controllers/b2cCallbackController");
const { accountBalanceCallback } = require("../controllers/mpesaAccountBalanceCallback");

const router = express.Router();

// STK Push callback

router.post("/stk/callback",express.json({ type: "*/*" }), stkCallback);

// B2C Payment callback (loan disbursement / withdrawals)
router.post('/b2c/callback', b2cCallback)
// Transaction Reversal callbacks

router.post("/reversal/result", reversalResultHandler);
router.post("/reversal/timeout", reversalTimeoutHandler);


router.post("/account-balance/callback", accountBalanceCallback);
module.exports = router;