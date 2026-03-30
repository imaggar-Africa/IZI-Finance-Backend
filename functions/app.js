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

  // 🔥 IMPORTANT: Populate global.config so utilities like mpesa.js can use it
  if (!global.config || Object.keys(global.config).length === 0) {
    console.log("🟡 Initializing global.config from secrets/env...");
    global.config = {
      ...secrets,
      // Fallback for local development when secrets object is empty
      mpesaEnv: secrets.mpesaEnv || process.env.MPESA_ENV || "sandbox",
      mpesaConsumerKey: secrets.mpesaConsumerKey || process.env.MPESA_CONSUMER_KEY,
      mpesaConsumerSecret: secrets.mpesaConsumerSecret || process.env.MPESA_CONSUMER_SECRET,
      mpesaShortcode: secrets.mpesaShortcode || process.env.MPESA_SHORTCODE,
      mpesaPasskey: secrets.mpesaPasskey || process.env.MPESA_PASSKEY,
      mpesaStkCallback: secrets.mpesaStkCallback || process.env.MPESA_STK_CALLBACK_URL,
      mpesaB2cShortcode: secrets.mpesaB2cShortcode || process.env.MPESA_B2C_SHORTCODE,
      mpesaB2cInitiator: secrets.mpesaB2cInitiator || process.env.MPESA_B2C_INITIATOR,
      mpesaB2cCredential: secrets.mpesaB2cCredential || process.env.MPESA_B2C_SECURITY_CREDENTIAL,
      mpesaB2cResultUrl: secrets.mpesaB2cResultUrl || process.env.MPESA_B2C_RESULT_URL,
      mpesaB2cTimeoutUrl: secrets.mpesaB2cTimeoutUrl || process.env.MPESA_B2C_TIMEOUT_URL,
      mpesaReversalUrl: secrets.mpesaReversalUrl || process.env.MPESA_REVERSAL_URL,
      mpesaReversalResult: secrets.mpesaReversalResult || process.env.MPESA_REVERSAL_RESULT_URL,
      mpesaReversalTimeout: secrets.mpesaReversalTimeout || process.env.MPESA_REVERSAL_TIMEOUT_URL,
      jwtAccessSecret: secrets.jwtAccessSecret || process.env.JWT_ACCESS_SECRET,
      jwtRefreshSecret: secrets.jwtRefreshSecret || process.env.JWT_REFRESH_SECRET,
      atUsername: secrets.atUsername || process.env.AT_USERNAME,
      atApiKey: secrets.atApiKey || process.env.AT_API_KEY,
      atSenderId: secrets.atSenderId || process.env.AT_SENDER_ID,
      mongoUri: secrets.mongoUri || process.env.MONGO_URI,
      redisUrl: secrets.redisUrl || process.env.UPSTASH_REDIS_REST_URL,
      redisToken: secrets.redisToken || process.env.UPSTASH_REDIS_REST_TOKEN,
    };
  }

  const config = global.config;
  console.log("Initializing DB and Redis");

  try {
    await connectDB(config.mongoUri);
  } catch (err) {
    console.error("Mongo connection error:", err);
  }

  try {
    await ensureRedis(config.redisUrl, config.redisToken);
  } catch (err) {
    console.warn("Redis skipped:", err.message);
  }

  /*************************************************
   * STORE SECRETS
   *************************************************/

  app.locals.jwtAccessSecret = config.jwtAccessSecret;
  app.locals.jwtRefreshSecret = config.jwtRefreshSecret;

  app.locals.otpService = otpServiceFactory({
    atUsername: config.atUsername,
    atApiKey: config.atApiKey,
    atSenderId: config.atSenderId,
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
  app.use("/api/groups", jsonParser, require("./routes/groupRoutes"));
  app.use("/api/agent-groups", jsonParser, require("./routes/agentGroupRoutes"));

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