require("dotenv").config();

const {
  getAirtelAccessToken,
} = require("../functions/payment/airtel/airtelAuth.js");

(async () => {
  try {
    const token = await getAirtelAccessToken();
    console.log("✅ Airtel Sandbox Token:", token);
    process.exit(0);
  } catch (err) {
    console.error("❌ Airtel Token Error:", err.message);
    process.exit(1);
  }
})();
