const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require("mongo-sanitize");
const xss = require("xss");

/**
 * =========================
 * HELMET CONFIGURATION
 * =========================
 * Sets various HTTP headers to help protect the app from well-known vulnerabilities
 */
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false, // Disable for Firebase Functions compatibility
  crossOriginResourcePolicy: { policy: "cross-origin" },
});

/**
 * =========================
 * RATE LIMITING
 * =========================
 */

// General API rate limit - 100 requests per 15 minutes
const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: "Too many requests from this IP, please try again later.",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Stricter rate limit for authentication routes - 5 requests per 15 minutes
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    success: false,
    message: "Too many authentication attempts, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
});

// Rate limit for wallet/transaction routes - 20 requests per 15 minutes
const walletRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per windowMs
  message: {
    success: false,
    message: "Too many wallet/transaction requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * =========================
 * MONGODB INJECTION PROTECTION
 * =========================
 * Sanitizes req.body, req.query, and req.params to prevent NoSQL injection attacks
 */
const mongoSanitizeMiddleware = (req, res, next) => {
  if (req.body) {
    req.body = mongoSanitize(req.body);
  }
  if (req.query) {
    req.query = mongoSanitize(req.query);
  }
  if (req.params) {
    req.params = mongoSanitize(req.params);
  }
  next();
};

/**
 * =========================
 * XSS PROTECTION UTILITIES
 * =========================
 */

/**
 * Sanitize a string to prevent XSS attacks
 * @param {string} input - String to sanitize
 * @returns {string} - Sanitized string
 */
const sanitizeString = (input) => {
  if (typeof input !== "string") return input;
  return xss(input);
};

/**
 * Sanitize an object recursively to prevent XSS attacks
 * @param {any} obj - Object to sanitize
 * @returns {any} - Sanitized object
 */
const sanitizeObject = (obj) => {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item));
  }

  if (typeof obj === "object") {
    const sanitized = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        sanitized[key] = sanitizeObject(obj[key]);
      }
    }
    return sanitized;
  }

  return obj;
};

/**
 * XSS Protection Middleware
 * Sanitizes req.body to prevent XSS attacks
 */
const xssProtectionMiddleware = (req, res, next) => {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeObject(req.body);
  }
  next();
};

module.exports = {
  helmetMiddleware,
  generalRateLimit,
  authRateLimit,
  walletRateLimit,
  mongoSanitizeMiddleware,
  xssProtectionMiddleware,
  sanitizeString,
  sanitizeObject,
};

