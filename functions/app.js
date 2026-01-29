process.on("uncaughtException", err => {
  console.error("UNCAUGHT:", err);
});

process.on("unhandledRejection", err => {
  console.error("UNHANDLED:", err);
});

require("dotenv").config(); // ✅ sSAFE – Firebase ignores this in prod
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const { ensureRedis } = require("./utils/redis");
const otpServiceFactory = require("./utils/africatalking");

const app = express();
let initialized = false;

// -----------------------------------------------------
//  FIX 1: DO NOT parse JSON globally (breaks file upload)
//  Only parse JSON for non-upload routes later.
// -----------------------------------------------------
app.use(cors({ origin: true }));

// Health checks BEFORE initialization
app.get("/", (req, res) => {
  res.status(200).json({
    status: "healthy",
    message: "🔥 Firebase Function is Running Successfully!",
    timestamp: new Date().toISOString(),
  });
});


// -----------------------------------------------------
// Multer (Memory Storage)
// -----------------------------------------------------




app.get("/ping", (_req, res) => res.send("pong"));

// -----------------------------------------------------
// Multer (Memory Storage)
// -----------------------------------------------------

// -----------------------------------------------------
// INITIALIZATION FUNCTION
// -----------------------------------------------------
async function initializeApp(secrets = {}) {
  if (initialized) return;

  console.log("📦 Initializing database + redis + services...");

  // MongoDB
  await connectDB(secrets.mongoUri);

  // Redis
  await ensureRedis(secrets.redisUrl, secrets.redisToken);

  // JWT (used by auth middleware)
  process.env.JWT_ACCESS_SECRET = secrets.jwtAccessSecret;
  process.env.JWT_REFRESH_SECRET = secrets.jwtRefreshSecret;

  // OTP service
  app.locals.otpService = otpServiceFactory({
    atUsername: secrets.atUsername,
    atApiKey: secrets.atApiKey,
    atSenderId: secrets.atSenderId,
  });


  /* =======================
     BODY PARSERS
     ======================= */
  const jsonParser = express.json({ limit: "10mb" });
  const urlEncodedParser = express.urlencoded({ extended: true });
  /* =======================
     ROUTES
     ======================= */
  app.use("/api/customers", jsonParser, require("./routes/customerRoutes"));
  app.use("/api/agent", jsonParser, require("./routes/agentRoutes"));
  app.use("/ussd", jsonParser, require("./routes/ussdRoutes"));
  app.use("/api/mpesa", jsonParser, require("./routes/mpesaCallbackRoutes"));
  app.use("/api/auth", jsonParser, require("./routes/authRoutes"));
  app.use("/api/auth/borrower", jsonParser, require("./routes/borrowerauthRouter"));
  app.use("/api/wallet", jsonParser, require("./routes/walletRoutes"));
  app.use("/api/loans", jsonParser, require("./routes/loanRoutes"));
  app.use("/api", jsonParser, require("./routes/activityRoutes"));
  app.use("/api/suggestions", jsonParser, require("./routes/suggestionRoutes"));
  app.use("/api/transactions", jsonParser, require("./routes/transactionRoutes"));
  app.use("/api/stats", jsonParser, require("./routes/statsRoutes"));
  app.use("/api/profile", jsonParser, require("./routes/profileRoutes"));
  app.use("/api/reminder", jsonParser, require("./routes/reminderRoutes"));
  app.use("/api/notifications", jsonParser, require("./routes/notificationRoutes"));
  app.use("/api/otp", jsonParser, require("./routes/otpRoutes"));
  app.use("/api/lender", jsonParser, require("./routes/lenderRoutes"));
  app.use("/api/reports", jsonParser, require("./routes/reportRoutes"));
  app.use("/api/c2b", jsonParser, require("./routes/c2bRoutes"));
  app.use("/api", jsonParser, require("./routes/qrRoutes"))
  app.use("/api", urlEncodedParser, require("./routes/paymentPage"));
  app.use("/api", urlEncodedParser, require("./routes/stkPayment"));
  app.use("/debug", require("./routes/debug"));

  /* =======================
     ERRORSsss
     ======================= */
  app.use((req, res) =>
    res.status(404).json({ message: "API Route Not Found" })
  );

  app.use((err, _req, res, _next) => {
    console.error("🔥 SERVER ERROR:", err);
    res.status(500).json({ message: "Internal Server Error" });
  });

 


  initialized = true;
  console.log("✅ App initialization complete");
}

// ================= ECS / LOCAL =================
if (!process.env.FUNCTION_TARGET) {
  const PORT = Number(process.env.PORT) || 8081; // ⛔ never 8080 on Windows

  (async () => {
    try {
      await initializeApp();

      const server = app.listen(8081, "0.0.0.0", () => {
        console.log(`🚀 Server running on port ${PORT}`);
      });

      server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          console.error(`❌ Port ${PORT} is already in use`);
        } else {
          console.error("❌ Server error:", err);
        }
        process.exit(1);
      });

    } catch (err) {
      console.error("❌ Startup failed", err);
      process.exit(1);
    }
  })();
}
c53a686c102ce923b94dd1e67e0f4a0a4e9fe4f3
module.exports = { app, initializeApp };


