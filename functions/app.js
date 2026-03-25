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
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const connectDB = require("./config/db");
const { ensureRedis } = require("./utils/redis");
const otpServiceFactory = require("./utils/africatalking");

const {
  helmetMiddleware,
  generalRateLimit,
  authRateLimit,
  walletRateLimit,
  mongoSanitizeMiddleware,
  xssProtectionMiddleware,
} = require("./middleware/securityMiddleware");

const { sanitizeAll } = require("./middleware/sanitizationMiddleware");

const app = express();
app.set("trust proxy", 1);

let initialized = false;

/*************************************************
 * HEALTH CHECK ROUTES (MUST BE FIRST)
 *************************************************/

app.get("/healthz", (_req, res) => res.status(200).send("OK"));

app.get("/ping", (_req, res) => res.send("pong"));

app.get("/version", (_req, res) => {
  res.status(200).json({
    api: "v2",
    deployedAt: new Date().toISOString(),
  });
});

/*************************************************
 * GLOBAL MIDDLEWARE
 *************************************************/

app.use(cors({ origin: true }));

if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined"));
}

app.use(helmetMiddleware);

if (process.env.NODE_ENV === "production") {
  app.use(generalRateLimit);
}

app.use(mongoSanitizeMiddleware);
app.use(xssProtectionMiddleware);
app.use(sanitizeAll);

/*************************************************
 * LAZY INITIALIZATION (ONLY ONE)
 *************************************************/

// app.use(async (req, res, next) => {
//   if (!initialized) {
//     console.log("🚀 Lazy initializing app...");

//     try {
//       const config = global.config || {};
//       await initializeApp(config);
//     } catch (err) {
//       console.error("❌ Lazy init failed:", err);

//       return res.status(500).json({
//         error: "Initialization failed",
//         details: err.message,
//       });
//     }
//   }

//   next();
// });

/*************************************************
 * ROOT STATUS
 *************************************************/

app.get("/", (_req, res) => {
  res.status(200).json({
    status: "healthy",
    service: "IZI Finance Backend",
    timestamp: new Date().toISOString(),
    initialized: initialized,
  });
});

/*************************************************
 * INITIALIZATION
 *************************************************/

async function initializeApp(secrets = {}) {
  if (initialized) return;

  console.log("Initializing DB and Redis");

  try {
    await connectDB(secrets.mongoUri);
  } catch (err) {
    console.error("Mongo connection error:", err);
  }

  try {
    await ensureRedis(secrets.redisUrl, secrets.redisToken);
  } catch (err) {
    console.warn("Redis skipped:", err.message);
  }

  /*************************************************
   * STORE SECRETS
   *************************************************/

  app.locals.jwtAccessSecret = secrets.jwtAccessSecret;
  app.locals.jwtRefreshSecret = secrets.jwtRefreshSecret;

  app.locals.otpService = otpServiceFactory({
    atUsername: secrets.atUsername,
    atApiKey: secrets.atApiKey,
    atSenderId: secrets.atSenderId,
  });

  /*************************************************
   * BODY PARSERS
   *************************************************/

  const jsonParser = express.json({ limit: "10mb" });
  const urlEncodedParser = express.urlencoded({ extended: true });

  /*************************************************
   * ROUTES
   *************************************************/

  app.use("/api/customers", jsonParser, require("./routes/customerRoutes"));
  app.use("/api/guarantors", jsonParser, require("./routes/guarantorRoutes"));
  app.use("/api/next-of-kin", jsonParser, require("./routes/nextOfKinRoutes"));
  app.use("/api/agent", jsonParser, require("./routes/agentRoutes"));
  app.use("/ussd", jsonParser, require("./routes/ussdRoutes"));
  app.use("/api/mpesa", jsonParser, require("./routes/mpesaCallbackRoutes"));

  app.use("/api/auth", authRateLimit, jsonParser, require("./routes/authRoutes"));

  app.use(
    "/api/auth/borrower",
    authRateLimit,
    jsonParser,
    require("./routes/borrowerauthRouter")
  );

  app.use(
    "/api/wallet",
    walletRateLimit,
    jsonParser,
    require("./routes/walletRoutes")
  );

  app.use("/api/loans", jsonParser, require("./routes/loanRoutes"));
  app.use("/api", jsonParser, require("./routes/activityRoutes"));
  app.use("/api/suggestions", jsonParser, require("./routes/suggestionRoutes"));
  app.use("/api/transactions", jsonParser, require("./routes/transactionRoutes"));
  app.use("/api/stats", jsonParser, require("./routes/statsRoutes"));
  app.use("/api/profile", require("./routes/profileRoutes"));
  app.use("/api/reminder", jsonParser, require("./routes/reminderRoutes"));
  app.use("/api/notifications", jsonParser, require("./routes/notificationRoutes"));
  app.use("/api/otp", jsonParser, require("./routes/otpRoutes"));
  app.use("/api/lender", jsonParser, require("./routes/lenderRoutes"));
  app.use("/api/reports", jsonParser, require("./routes/reportRoutes"));
  app.use("/api/c2b", jsonParser, require("./routes/c2bRoutes"));
  app.use("/api", jsonParser, require("./routes/qrRoutes"));
  app.use("/api", urlEncodedParser, require("./routes/paymentPage"));
  app.use("/api", urlEncodedParser, require("./routes/stkPayment"));

  /*************************************************
   * ERROR HANDLING
   *************************************************/

  const { errorHandler, notFoundHandler } = require("./middleware/errorMiddleware");

  app.use(notFoundHandler);
  app.use(errorHandler);

  initialized = true;

  console.log("✅ App initialized");
}

/*************************************************
 * EXPORTS
 *************************************************/

module.exports = {
  app,
  initializeApp,
};