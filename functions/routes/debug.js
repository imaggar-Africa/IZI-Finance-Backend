const express = require("express");
const router = express.Router();

router.get("/secrets", (req, res) => {

  if (!global.config) {
    return res.status(503).json({
      status: "initializing",
      message: "Secrets loading... try again."
    });
  }

  return res.json({
    status: "ready",
    environment: global.config.mpesaEnv?.trim(),
    shortcode: global.config.mpesaShortcode?.trim(),

    consumerKeyLoaded: !!global.config.mpesaConsumerKey,
    consumerSecretLoaded: !!global.config.mpesaConsumerSecret,

    confirmURL: global.config.mpesaC2bConfirmUrl?.trim() || null,
    validateURL: global.config.mpesaC2bValidateUrl?.trim() || null
  });
});

/**
 * 📢 Push Notification Test
 * Send a POST to /debug/test-push with token, title, and message.
 */
router.post("/test-push", async (req, res) => {
  try {
    const { token, title, message } = req.body;
    const { sendPushNotification } = require("../utils/expoPush");

    if (!token || !title || !message) {
      return res.status(400).json({ error: "Missing required fields (token, title, message)" });
    }

    const tickets = await sendPushNotification(token, title, message, { test: true });

    res.status(200).json({
      success: true,
      message: "Push attempt completed",
      tickets
    });
  } catch (error) {
    console.error("Test Push Error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
