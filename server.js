require("dotenv").config();
const { app, initializeApp } = require("./functions/app");

const PORT = process.env.PORT || 8080;
const uri = process.env.MONGO_URI?.trim();

// Prevent running inside Cloud/Emulator
const isCloudRuntime =
  !!process.env.K_SERVICE ||
  !!process.env.FUNCTION_TARGET ||
  !!process.env.FUNCTIONS_EMULATOR;

if (isCloudRuntime) {
  throw new Error("❌ server.js must not run in Cloud/Emulator runtime");
}

(async () => {
  try {
    await initializeApp();
    app.listen(PORT, () => {
      console.log(`✅ Local server running on http://localhost:${PORT}`);
      console.log(`${uri}`)
    });
  } catch (err) {
    console.error("❌ Failed to initialize app:", err);
    process.exit(1);
  }
})();
