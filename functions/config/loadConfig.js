// config/initConfig.js
module.exports = async function initConfig() {
  if (global.config) {
    console.log("🟢 global.config already initialized");
    return;
  }

  console.log("🟡 Initializing global.config in worker...");

  console.log("🔍 ENV CHECK:");
  console.log("AT_USERNAME =", process.env.AT_USERNAME);
  console.log("AT_API_KEY  =", process.env.AT_API_KEY ? "FOUND" : "MISSING");
  console.log("AT_SENDER_ID =", process.env.AT_SENDER_ID);

  global.config = {
    atUsername: process.env.AT_USERNAME,
    atApiKey: process.env.AT_API_KEY,
    atSenderId: process.env.AT_SENDER_ID
  };

  console.log("🔍 CONFIG CHECK:");
  console.log("config.atUsername =", global.config.atUsername);
  console.log(
    "config.atApiKey =",
    global.config.atApiKey ? "FOUND" : "MISSING"
  );
  console.log("config.atSenderId =", global.config.atSenderId);

  console.log("✅ global.config initialized in worker");
};