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
const { buildConfigFromEnv } = require("./config/buildConfigFromEnv");
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

function requireStep(step, loader) {
  try {
    return loader();
  } catch (err) {
    const wrapped = new Error(`${step}: ${err.message}`);
    wrapped.initStep = step;
    wrapped.stack = err.stack || wrapped.stack;
    throw wrapped;
  }
}

async function initializeApp(secrets = {}) {
  if (initialized) return;

  // 🔥 IMPORTANT: Populate global.config so utilities like mpesa.js can use it
  if (!global.config || Object.keys(global.config).length === 0) {
    console.log("🟡 Initializing global.config from secrets/env...");
    global.config = { ...buildConfigFromEnv(), ...secrets };
  }

  const config = global.config;
  if (config.mongoUri && !process.env.MONGO_URI) {
    process.env.MONGO_URI = config.mongoUri;
  }
  const mongoUri = (
    config.mongoUri ||
    process.env.MONGO_URI ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
  if (process.env.IZI_RUNTIME === "vercel" && !mongoUri) {
    const err = new Error("MONGO_URI is required on Vercel");
    err.initStep = "db:config";
    throw err;
  }
  console.log("Initializing DB and Redis");

  try {
    await connectDB(config.mongoUri);
  } catch (err) {
    console.error("Mongo connection error:", err);
    err.initStep = err.initStep || "db:connect";
    if (process.env.IZI_RUNTIME === "vercel") throw err;
  }

  try {
    await ensureRedis(config);
  } catch (err) {
    console.warn("Redis skipped:", err.message);
  }

  /*************************************************
   * STORE SECRETS
   *************************************************/

  app.locals.jwtAccessSecret = config.jwtAccessSecret;
  app.locals.jwtRefreshSecret = config.jwtRefreshSecret;

  app.locals.otpService = requireStep("otp:service", () =>
    otpServiceFactory({
      atUsername: config.atUsername,
      atApiKey: config.atApiKey,
      atSenderId: config.atSenderId,
    }),
  );

  /*************************************************
   * BODY PARSERS
   *************************************************/

  const jsonParser = express.json({ limit: "10mb" });
  const urlEncodedParser = express.urlencoded({ extended: true });

  /*************************************************
   * ROUTES
   *************************************************/

  const route = (step, relPath) =>
    requireStep(step, () => require(relPath));

  app.use("/api/customers", route("routes:customerRoutes", "./routes/customerRoutes"));
  app.use("/api/guarantors", jsonParser, route("routes:guarantorRoutes", "./routes/guarantorRoutes"));
  app.use("/api/next-of-kin", jsonParser, route("routes:nextOfKinRoutes", "./routes/nextOfKinRoutes"));
  app.use("/api/agent", route("routes:agentRoutes", "./routes/agentRoutes"));
  app.use("/ussd", jsonParser, route("routes:ussdRoutes", "./routes/ussdRoutes"));
  app.use("/api/mpesa", jsonParser, route("routes:mpesaCallbackRoutes", "./routes/mpesaCallbackRoutes"));
  app.use("/api/groups", jsonParser, route("routes:groupRoutes", "./routes/groupRoutes"));
  app.use("/api/agent-groups", jsonParser, route("routes:agentGroupRoutes", "./routes/agentGroupRoutes"));

  app.use("/api/auth", authRateLimit, jsonParser, route("routes:authRoutes", "./routes/authRoutes"));

  app.use(
    "/api/auth/borrower",
    authRateLimit,
    jsonParser,
    route("routes:borrowerauthRouter", "./routes/borrowerauthRouter"),
  );

  app.use(
    "/api/wallet",
    walletRateLimit,
    jsonParser,
    route("routes:walletRoutes", "./routes/walletRoutes"),
  );

  app.use("/api/loans", route("routes:loanRoutes", "./routes/loanRoutes"));
  app.use("/api", jsonParser, route("routes:activityRoutes", "./routes/activityRoutes"));
  app.use("/api/suggestions", jsonParser, route("routes:suggestionRoutes", "./routes/suggestionRoutes"));
  app.use("/api/transactions", jsonParser, route("routes:transactionRoutes", "./routes/transactionRoutes"));
  app.use("/api/stats", jsonParser, route("routes:statsRoutes", "./routes/statsRoutes"));
  app.use("/api/profile", route("routes:profileRoutes", "./routes/profileRoutes"));
  app.use("/api/reminder", jsonParser, route("routes:reminderRoutes", "./routes/reminderRoutes"));
  app.use("/api/notifications", jsonParser, route("routes:notificationRoutes", "./routes/notificationRoutes"));
  app.use("/api/otp", jsonParser, route("routes:otpRoutes", "./routes/otpRoutes"));
  app.use("/api/sms", jsonParser, route("routes:sms.routes", "./routes/sms.routes"));
  app.use("/api/lender", jsonParser, route("routes:lenderRoutes", "./routes/lenderRoutes"));
  app.use("/api/reports", route("routes:reportRoutes", "./routes/reportRoutes"));
  app.use("/api/c2b", jsonParser, route("routes:c2bRoutes", "./routes/c2bRoutes"));
  app.use("/api", jsonParser, route("routes:qrRoutes", "./routes/qrRoutes"));
  app.use("/api", urlEncodedParser, route("routes:paymentPage", "./routes/paymentPage"));
  app.use("/api", urlEncodedParser, route("routes:stkPayment", "./routes/stkPayment"));
  app.get(["/api/obliterate-queue-temp", "/obliterate-queue-temp"], async (req, res) => {
    try {
      const { Queue } = require("bullmq");
      const bullRedis = require("./queues/redis");
      const queue = new Queue("sms-queue", { connection: bullRedis });
      await queue.obliterate({ force: true });
      await queue.close();
      res.send("Queue obliterated on production successfully!");
    } catch (err) {
      res.status(500).send("Error: " + err.message);
    }
  });

  app.get(["/api/trigger-penalty-cron", "/trigger-penalty-cron"], async (req, res) => {
    try {
      const { loanId } = req.query;
      const { checkLoansAndSendReminders } = require("./utils/cron/loanCron");
      await checkLoansAndSendReminders(loanId || null);
      res.status(200).json({ success: true, message: `checkLoansAndSendReminders triggered successfully${loanId ? ' for loan ' + loanId : ''}.` });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /*************************************************
   * ERROR HANDLING
   *************************************************/

  const { errorHandler, notFoundHandler } = requireStep(
    "middleware:errorMiddleware",
    () => require("./middleware/errorMiddleware"),
  );

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