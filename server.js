require("dotenv").config();

const { app, initializeApp } = require("./functions/app");

// Set normal port
const PORT = 9001;

(async () => {
  try {
    await initializeApp();

    // Start background background workers
    require("./functions/utils/cron/loanCron");
    require("./functions/queues/sms.worker"); // ✅ Start SMS Queue Worker

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`✅ Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
})();