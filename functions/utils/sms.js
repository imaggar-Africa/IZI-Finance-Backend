const africastalking = require("africastalking");
const { normalizePhone } = require("./normalizePhone");

// ------------------------------
// AfricasTalking SMS client
// ------------------------------
let smsClient = null;
let isSMSInitialized = false;

// Lazy initialize SMS client AFTER onInit sets global.config
const initSMS = () => {
  if (isSMSInitialized) return;

  const AT_USERNAME = (process.env.AT_USERNAME || "").trim();
  const AT_API_KEY = (process.env.AT_API_KEY || "").trim();

  if (!AT_USERNAME || !AT_API_KEY) {
    console.warn("⚠️ AfricasTalking credentials missing; SMS disabled");
    isSMSInitialized = true;
    return;
  }

  try {
    const client = africastalking({
      apiKey: AT_API_KEY,
      username: AT_USERNAME,
    });

    smsClient = client.SMS;
    console.log("✅ AfricasTalking SMS client initialized");
  } catch (err) {
    console.error("❌ Failed to initialize AfricasTalking:", err);
  }

  isSMSInitialized = true;
};


// ------------------------------
// Send SMS function
// ------------------------------
exports.sendSMS = async (phoneNumber, message) => {
  try {
    if (!isSMSInitialized) initSMS();

    const normalizedPhone = normalizePhone(phoneNumber);

    if (!normalizedPhone) {
      console.warn("⚠️ SMS skipped. Invalid phone:", phoneNumber);
      return { success: false, message: "Invalid phone number" };
    }

    if (!smsClient) {
      return { success: false, message: "SMS client not initialized" };
    }

    console.log("📨 Sending SMS ->", normalizedPhone, message);

    const payload = {
      to: [normalizedPhone],
      message,
    };

    // Include sender ID only if not sandbox
    const senderId = global.config?.atSenderId?.trim();
    if (senderId && global.config.atUsername !== "sandbox") {
      payload.from = senderId;
    }

    const result = await smsClient.send(payload);

    console.log("📩 SMS Response:", JSON.stringify(result, null, 2));
    return result;

  } catch (error) {
    console.error("❌ Error sending SMS:", error.message);
    return { success: false, error: error.message };
  }
};
