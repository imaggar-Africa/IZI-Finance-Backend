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


  // -----------------------------------------------------
// 1️⃣ UPLOAD ROUTES (MUST COME FIRST + OUTSIDE /api)
// -----------------------------------------------------
app.use("/api/customers", require("./routes/customerRoutes"));  // ← FIXED
app.use("/api/agent", require("./routes/agentRoutes")); // optional



  // -----------------------------------------------------
  // FIX 2 — JSON PARSER ONLY FOR JSON ROUTES
  // -----------------------------------------------------
  const jsonParser = express.json({ limit: "10mb" });
  const urlParser = express.urlencoded({ extended: true, limit: "10mb" });

  // JSON ROUTES ONLY
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
app.use("/api/borrowers",jsonParser,require("./routes/borrowerBusinessProfileRoutes"));
app.use(
  "/api/borrowers/next-of-kin",
  jsonParser,
  require("./routes/nextOfKinRoutes")
);

app.use(
  "/api/guarantor",
  jsonParser,
  require("./routes/guarantorRoutes")
);

// Debug route to confirm secrets loaded
app.use("/debug", require("./routes/debug"));

// C2B callback handler (public endpoint for Safaricom)


// Registration route (your internal API)
// app.use("/api", jsonParser, require("./routes/mpesaRegisterRoute"));
const c2bRoutes = require("./routes/c2bRoutes");
app.use("/api/c2b", c2bRoutes);

  // Fallback 404
  app.use((req, res) => res.status(404).json({ message: "API Route Not Found" }));

  // Global fail-safe error handler
  app.use((err, req, res, next) => {
    console.error("🔥 SERVER ERROR:", err);
    res.status(500).json({ message: "Internal Server Error" });
  });

  initialized = true;
  console.log("✅ App fully initialized!");
}

module.exports = { app, initializeApp, };
