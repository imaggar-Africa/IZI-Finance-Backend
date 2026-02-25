const africastalking = require("africastalking");
const { normalizePhone } = require("./normalizePhone");
const smsQueue = require("../queues/sms.queue");

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
    const normalizedPhone = normalizePhone(phoneNumber);

    if (!normalizedPhone) {
      console.warn("⚠️ SMS skipped. Invalid phone:", phoneNumber);
      return { success: false, message: "Invalid phone number" };
    }

    await smsQueue.add("send-sms", {
      phoneNumber: normalizedPhone,
      message
    });

    console.log("📥 SMS queued ->", normalizedPhone);

    return {
      success: true,
      message: "SMS queued successfully"
    };

  } catch (error) {
    console.error("❌ Error queueing SMS:", error.message);
    return { success: false, error: error.message };
  }
};
