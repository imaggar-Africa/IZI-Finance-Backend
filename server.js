require("dotenv").config();

const { app, initializeApp } = require("./functions/app");

// Set normal port
const PORT = process.env.PORT || 9001;

(async () => {
  try {
    await initializeApp();

    console.log("ℹ️ Skipping local cron jobs and queue workers on localhost");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`✅ Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
})();