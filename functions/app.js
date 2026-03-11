



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
const morgan = require("morgan"); // ✅ Morgan logger

const connectDB = require("./config/db");
const { ensureRedis } = require("./utils/redis");
const otpServiceFactory = require("./utils/africatalking");

// ✅ Load dotenv ONLY for emulator
if (process.env.FUNCTIONS_EMULATOR) {
  require("dotenv").config();
}

// ❌ DO NOT run localInit in Cloud Functions
if (process.env.FUNCTIONS_EMULATOR) {
  require("./utils/localInit")();
}

// Security & Validation Middleware
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
 * MIDDLEWARE (SAFE AT LOAD TIME)
 *************************************************/

app.use(cors({ origin: true }));

// ✅ Request Logger
if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
} else {
  app.use(
    morgan("combined", {
      stream: {
        write: (message) => console.log(message.trim()),
      },
    })
  );
}

app.use(helmetMiddleware);

if (process.env.NODE_ENV !== "development") {
  app.use(generalRateLimit);
}

app.use(mongoSanitizeMiddleware);
app.use(xssProtectionMiddleware);
app.use(sanitizeAll);

/*************************************************
 * HEALTH CHECKS (VERY IMPORTANT FOR CLOUD RUN)
 *************************************************/

app.get("/", (_req, res) => {
  res.status(200).json({
    status: "healthy",
    service: "IZI Finance Backend..!",
    timestamp: new Date().toISOString(),
  });
});

app.get("/healthz", (_req, res) => res.status(200).send("OK"));

app.get("/version", (_req, res) => {
  res.status(200).json({
    api: "v2",
    deployedAt: new Date().toISOString(),
  });
});

app.get("/ping", (_req, res) => res.send("pong"));

/*************************************************
 * INITIALIZATION (LAZY – RUNS ON FIRST REQUEST)
 *************************************************/

async function initializeApp(secrets = {}) {
  if (initialized) return;

  console.log("📦 Initializing DB, Redis, services...");

  try {
    await connectDB(secrets.mongoUri || process.env.MONGO_URI);

    await ensureRedis(
      secrets.redisUrl || process.env.REDIS_URL,
      secrets.redisToken || process.env.REDIS_TOKEN
    );
  } catch (err) {
    console.error("❌ Init error (non-fatal):", err);
  }

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

  app.use("/api/wallet", walletRateLimit, jsonParser, require("./routes/walletRoutes"));
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
  app.use("/debug", require("./routes/debug"));
  app.use("/api/groups", jsonParser, require("./routes/groupRoutes"));
  app.use("/api/agent-groups", jsonParser, require("./routes/agentGroupRoutes"));
  app.use("/api/kyc/company", jsonParser, require("./routes/companyKycRoutes"));
  app.use("/api", jsonParser, require("./routes/sms.routes"));

  /*************************************************
   * ERROR HANDLING
   *************************************************/

  const {
    errorHandler,
    notFoundHandler,
  } = require("./middleware/errorMiddleware");

  app.use(notFoundHandler);
  app.use(errorHandler);

  initialized = true;
  console.log("✅ App initialization complete");
}

/*************************************************
 * EXPORTS (FOR FIREBASE FUNCTIONS)
 *************************************************/

module.exports = {
  app,
  initializeApp,
};