require("dotenv").config(); // ✅ sSAFE – Firebase ignores this in prod
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const { ensureRedis } = require("./utils/redis");
const otpServiceFactory = require("./utils/africatalking");

const app = express();
let initialized = false;

app.use(cors({ origin: true }));

// ---------------- HEALTH ----------------
app.get("/", (req, res) => {
  res.status(200).json({
    status: "healthy",
    message: "🔥 API is running",
    timestamp: new Date().toISOString(),
  });
});

app.get("/ping", (_req, res) => res.send("pong"));

// ---------------- INIT FUNCTION ----------------
async function initializeApp() {
  if (initialized) return;

  console.log("📦 Initializing database + redis + services...");

  // ✅ USE ENV DIRECTLY (NOT secrets)
  await connectDB(process.env.MONGO_URI);
  await ensureRedis(
    process.env.UPSTASH_REDIS_REST_URL,
    process.env.UPSTASH_REDIS_REST_TOKEN
  );

  // OTP service
  app.locals.otpService = otpServiceFactory({
    atUsername: process.env.AT_USERNAME,
    atApiKey: process.env.AT_API_KEY,
    atSenderId: process.env.AT_SENDER_ID,
  });

  // ---------------- BODY PARSERS ----------------
  const jsonParser = express.json({ limit: "10mb" });
  const urlParser = express.urlencoded({ extended: true, limit: "10mb" });

  // ---------------- ROUTES ----------------
  app.use("/api/customers",jsonParser, require("./routes/customerRoutes"));
  app.use("/api/agent", require("./routes/agentRoutes"));

  app.use("/ussd", jsonParser, require("./routes/ussdRoutes"));
  app.use("/api/mpesa", jsonParser, require("./routes/mpesaCallbackRoutes"));
  app.use("/api/auth", jsonParser, require("./routes/authRoutes"));
  app.use("/api/wallet", jsonParser, require("./routes/walletRoutes"));
  app.use("/api/loans", jsonParser, require("./routes/loanRoutes"));
  app.use("/api/transactions", jsonParser, require("./routes/transactionRoutes"));
  app.use("/api/stats", jsonParser, require("./routes/statsRoutes"));
  app.use("/api/profile", jsonParser, require("./routes/profileRoutes"));
  app.use("/api/reminder", jsonParser, require("./routes/reminderRoutes"));
  app.use("/api/notifications", jsonParser, require("./routes/notificationRoutes"));
  app.use("/api/otp", jsonParser, require("./routes/otpRoutes"));
  app.use("/api/auth/borrower", jsonParser, require("./routes/borrowerauthRouter"));
  app.use("/api/lender", jsonParser, require("./routes/lenderRoutes"));
  app.use("/api", jsonParser, require("./routes/activityRoutes"));
  app.use("/api/suggestions", jsonParser, require("./routes/suggestionRoutes"));
  app.use("/api/borrowers", jsonParser, require("./routes/borrowerRoutes"));
  app.use("/api/borrowers", jsonParser, require("./routes/borrowerBusinessProfileRoutes"));
  app.use("/api/borrowers/next-of-kin", jsonParser, require("./routes/nextOfKinRoutes"));
  app.use("/api/guarantor", jsonParser, require("./routes/guarantorRoutes"));
  app.use("/api/airtel", jsonParser, require("./routes/airtelRoutes"));
  app.use("/api/mtn", jsonParser, require("./routes/mtnRoutes"));
  app.use("/api/vodacom", jsonParser, require("./routes/vodacom.routes"));
  app.use("/api/reports",jsonParser, require("./routes/reportRoutes"));
  app.use("/api/phone", require("./routes/phoneTestRoutes"));
app.use("/api/qr", jsonParser, require("./routes/qrRoutes"));


  app.use("/debug", require("./routes/debug"));
  app.use("/api/c2b", require("./routes/c2bRoutes"));

  // ---------------- ERRORS ----------------
  app.use((req, res) =>
    res.status(404).json({ message: "API Route Not Found" })
  );

  app.use((err, req, res, _next) => {
    console.error("🔥 SERVER ERROR:", err);
    res.status(500).json({ message: "Internal Server Error" });
  });

  initialized = true;
  console.log("✅ App initialization complete");
}
// ================= ECS ONLY =================
// This runs ONLY in ECS, NOT in Firebase
if (!process.env.FUNCTION_TARGET) {
  const PORT = process.env.PORT || 3000;

  (async () => {
    try {
      await initializeApp();

      app.listen(PORT, "0.0.0.0", () => {
        console.log("🚀 ECS server running on port", PORT);
      });
    } catch (err) {
      console.error("❌ Startup failed", err);
      process.exit(1);
    }
  })();
}
module.exports = { app, initializeApp };


