/*************************************************
 * GLOBAL ERROR SAFETY NET
 *************************************************/
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

/*************************************************
 * BASE SETUP
 *************************************************/
require("dotenv").config(); // Safe for local, ignored in prod (ECS/Firebase)

const express = require("express");
const cors = require("cors");

const connectDB = require("./config/db");
const { ensureRedis } = require("./utils/redis");
const otpServiceFactory = require("./utils/africatalking");

const app = express();
let initialized = false;

/*************************************************
 * MIDDLEWARE (SAFE)
 *************************************************/
app.use(cors({ origin: true }));

/*************************************************
 * HEALTH CHECK (ALB / ECS)
 *************************************************/
app.get("/", (_req, res) => {
  res.status(200).json({
    status: "healthy",
    service: "IZI Finance Backend..!",
    timestamp: new Date().toISOString(),
  });
});

app.get("/ping", (_req, res) => res.send("pong"));

/*************************************************
 * INITIALIZATION (RUNS ONCE)
 *************************************************/
async function initializeApp(secrets = {}) {
  if (initialized) return;

  console.log("📦 Initializing database + redis + services...");

  // MongoDB
  await connectDB(secrets.mongoUri || process.env.MONGO_URI);

  // Redis
  await ensureRedis(
    secrets.redisUrl || process.env.REDIS_URL,
    secrets.redisToken || process.env.REDIS_TOKEN
  );

  // JWT Secrets
  process.env.JWT_ACCESS_SECRET =
    secrets.jwtAccessSecret || process.env.JWT_ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET =
    secrets.jwtRefreshSecret || process.env.JWT_REFRESH_SECRET;

  // OTP Service
  app.locals.otpService = otpServiceFactory({
    atUsername: secrets.atUsername || process.env.AT_USERNAME,
    atApiKey: secrets.atApiKey || process.env.AT_API_KEY,
    atSenderId: secrets.atSenderId || process.env.AT_SENDER_ID,
  });

  /*************************************************
   * BODY PARSERS (ROUTE-SCOPED)
   *************************************************/
  const jsonParser = express.json({ limit: "10mb" });
  const urlEncodedParser = express.urlencoded({ extended: true });

  /*************************************************
   * ROUTES
   *************************************************/
  app.use("/api/customers", jsonParser, require("./routes/customerRoutes"));
  app.use("/api/agent", jsonParser, require("./routes/agentRoutes"));
  app.use("/ussd", jsonParser, require("./routes/ussdRoutes"));
  app.use("/api/mpesa", jsonParser, require("./routes/mpesaCallbackRoutes"));
  app.use("/api/auth", jsonParser, require("./routes/authRoutes"));
  app.use(
    "/api/auth/borrower",
    jsonParser,
    require("./routes/borrowerauthRouter")
  );
  app.use("/api/wallet", jsonParser, require("./routes/walletRoutes"));
  app.use("/api/loans", jsonParser, require("./routes/loanRoutes"));
  app.use("/api", jsonParser, require("./routes/activityRoutes"));
  app.use("/api/suggestions", jsonParser, require("./routes/suggestionRoutes"));
  app.use("/api/transactions", jsonParser, require("./routes/transactionRoutes"));
  app.use("/api/stats", jsonParser, require("./routes/statsRoutes"));
  app.use("/api/profile", jsonParser, require("./routes/profileRoutes"));
  app.use("/api/reminder", jsonParser, require("./routes/reminderRoutes"));
  app.use(
    "/api/notifications",
    jsonParser,
    require("./routes/notificationRoutes")
  );
  app.use("/api/otp", jsonParser, require("./routes/otpRoutes"));
  app.use("/api/lender", jsonParser, require("./routes/lenderRoutes"));
  app.use("/api/reports", jsonParser, require("./routes/reportRoutes"));
  app.use("/api/c2b", jsonParser, require("./routes/c2bRoutes"));
  app.use("/api", jsonParser, require("./routes/qrRoutes"));
  app.use("/api", urlEncodedParser, require("./routes/paymentPage"));
  app.use("/api", urlEncodedParser, require("./routes/stkPayment"));
  app.use("/debug", require("./routes/debug"));

  /*************************************************
   * ERROR HANDLING
   *************************************************/
  app.use((_req, res) =>
    res.status(404).json({ message: "API Route Not Found" })
  );

  app.use((err, _req, res, _next) => {
    console.error("🔥 SERVER ERROR:", err);
    res.status(500).json({ message: "Internal Server Error" });
  });

  initialized = true;
  console.log("✅ App initialization complete");
}

/*************************************************
 * EXPORTS (IMPORTANT)
 *************************************************/
module.exports = { app, initializeApp };