require("dotenv").config();

const { app, initializeApp } = require("./functions/app");

const PORT = Number(process.env.PORT) || 8081;

// ❌ Prevent running inside Firebase / Cloud Functions
if (
  process.env.K_SERVICE ||
  process.env.FUNCTION_TARGET ||
  process.env.FUNCTIONS_EMULATOR
) {
  throw new Error("❌ server.js must NOT run in Firebase runtime");
}

(async () => {
  try {
    await initializeApp();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
})();