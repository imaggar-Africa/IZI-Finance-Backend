const axios = require("axios");

/**
 * Get MTN MoMo access token
 * (SANDBOX BYPASS – MTN OAuth is unstable)
 */
const getMtnAccessToken = async () => {
  try {
    // 🔴 MTN Sandbox OAuth is unreliable
    // ✅ Use static sandbox token to proceed with development

    const accessToken = "FAKE_SANDBOX_TOKEN";

    return accessToken;
  } catch (error) {
    console.error("❌ MTN Auth Error:", error.message);
    throw new Error("Failed to get MTN access token");
  }
};

module.exports = {
  getMtnAccessToken,
};
