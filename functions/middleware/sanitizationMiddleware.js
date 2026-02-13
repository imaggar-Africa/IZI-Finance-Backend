const validator = require("validator");
const xss = require("xss");

/**
 * =========================
 * STRING SANITIZATION
 * =========================
 */

/**
 * Sanitize a string: trim whitespace and escape HTML
 * @param {string} input - String to sanitize
 * @param {Object} options - Sanitization options
 * @param {boolean} options.trim - Trim whitespace (default: true)
 * @param {boolean} options.escapeHtml - Escape HTML entities (default: true)
 * @param {boolean} options.removeNullBytes - Remove null bytes (default: true)
 * @returns {string} - Sanitized string
 */
const sanitizeString = (input, options = {}) => {
  if (typeof input !== "string") return input;

  const {
    trim = true,
    escapeHtml = true,
    removeNullBytes = true,
  } = options;

  let sanitized = input;

  // Remove null bytes (security risk)
  if (removeNullBytes) {
    sanitized = sanitized.replace(/\0/g, "");
  }

  // Trim whitespace
  if (trim) {
    sanitized = sanitized.trim();
  }

  // Escape HTML entities to prevent XSS
  if (escapeHtml) {
    sanitized = xss(sanitized);
  }

  return sanitized;
};

/**
 * =========================
 * NUMBER SANITIZATION
 * =========================
 */

/**
 * Sanitize a number: parse and validate
 * @param {any} input - Value to sanitize
 * @param {Object} options - Sanitization options
 * @param {number} options.min - Minimum value
 * @param {number} options.max - Maximum value
 * @param {boolean} options.allowFloat - Allow floating point numbers (default: true)
 * @returns {number|null} - Sanitized number or null if invalid
 */
const sanitizeNumber = (input, options = {}) => {
  const { min, max, allowFloat = true } = options;

  // Convert string to number if possible
  if (typeof input === "string") {
    const trimmed = input.trim();
    const parsed = allowFloat ? parseFloat(trimmed) : parseInt(trimmed, 10);
    if (isNaN(parsed)) return null;
    input = parsed;
  }

  // Check if it's a valid number
  if (typeof input !== "number" || isNaN(input) || !isFinite(input)) {
    return null;
  }

  // Apply min/max constraints
  let sanitized = input;
  if (min !== undefined && sanitized < min) return null;
  if (max !== undefined && sanitized > max) return null;

  return sanitized;
};

/**
 * =========================
 * EMAIL SANITIZATION
 * =========================
 */

/**
 * Sanitize and validate email address
 * @param {string} input - Email to sanitize
 * @returns {string|null} - Sanitized email or null if invalid
 */
const sanitizeEmail = (input) => {
  if (typeof input !== "string") return null;

  const trimmed = input.trim().toLowerCase();

  // Validate email format
  if (!validator.isEmail(trimmed)) {
    return null;
  }

  // Normalize email (remove extra spaces, etc.)
  return validator.normalizeEmail(trimmed) || trimmed;
};

/**
 * =========================
 * PHONE NUMBER SANITIZATION
 * =========================
 */

/**
 * Sanitize phone number: normalize format
 * @param {string} input - Phone number to sanitize
 * @returns {string|null} - Sanitized phone number or null if invalid
 */
const sanitizePhone = (input) => {
  if (typeof input !== "string") return null;

  // Remove all non-digit characters except +
  let sanitized = input.replace(/[^\d+]/g, "");

  // Ensure it starts with +
  if (!sanitized.startsWith("+")) {
    return null;
  }

  // Basic validation - should be between 10-15 characters
  if (sanitized.length < 10 || sanitized.length > 15) {
    return null;
  }

  return sanitized;
};

/**
 * =========================
 * URL SANITIZATION
 * =========================
 */

/**
 * Sanitize URL
 * @param {string} input - URL to sanitize
 * @returns {string|null} - Sanitized URL or null if invalid
 */
const sanitizeUrl = (input) => {
  if (typeof input !== "string") return null;

  const trimmed = input.trim();

  // Validate URL format
  if (!validator.isURL(trimmed)) {
    return null;
  }

  return trimmed;
};

/**
 * =========================
 * DEEP OBJECT SANITIZATION
 * =========================
 */

/**
 * Recursively sanitize an object
 * @param {any} obj - Object to sanitize
 * @param {Object} options - Sanitization options
 * @returns {any} - Sanitized object
 */
const sanitizeObject = (obj, options = {}) => {
  if (obj === null || obj === undefined) return obj;

  // Sanitize strings
  if (typeof obj === "string") {
    return sanitizeString(obj, options);
  }

  // Sanitize numbers
  if (typeof obj === "number") {
    if (isNaN(obj) || !isFinite(obj)) return null;
    return obj;
  }

  // Sanitize booleans (no sanitization needed, but ensure it's a boolean)
  if (typeof obj === "boolean") {
    return obj;
  }

  // Sanitize arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, options));
  }

  // Sanitize objects
  if (typeof obj === "object") {
    const sanitized = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        // Sanitize the key itself
        const sanitizedKey = sanitizeString(key, { escapeHtml: false });
        // Sanitize the value
        sanitized[sanitizedKey] = sanitizeObject(obj[key], options);
      }
    }
    return sanitized;
  }

  return obj;
};

/**
 * =========================
 * EXPRESS MIDDLEWARE
 * =========================
 */

/**
 * Sanitize request body
 * Trims strings, escapes HTML, validates numbers, emails, etc.
 */
const sanitizeBody = (req, res, next) => {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeObject(req.body, {
      trim: true,
      escapeHtml: true,
      removeNullBytes: true,
    });
  }
  next();
};

/**
 * Sanitize request query parameters
 */
const sanitizeQuery = (req, res, next) => {
  if (req.query && typeof req.query === "object") {
    req.query = sanitizeObject(req.query, {
      trim: true,
      escapeHtml: true,
      removeNullBytes: true,
    });
  }
  next();
};

/**
 * Sanitize request parameters
 */
const sanitizeParams = (req, res, next) => {
  if (req.params && typeof req.params === "object") {
    req.params = sanitizeObject(req.params, {
      trim: true,
      escapeHtml: true,
      removeNullBytes: true,
    });
  }
  next();
};

/**
 * Sanitize all request data (body, query, params)
 */
const sanitizeAll = (req, res, next) => {
  sanitizeBody(req, res, () => {
    sanitizeQuery(req, res, () => {
      sanitizeParams(req, res, next);
    });
  });
};

module.exports = {
  // Utility functions
  sanitizeString,
  sanitizeNumber,
  sanitizeEmail,
  sanitizePhone,
  sanitizeUrl,
  sanitizeObject,

  // Express middleware
  sanitizeBody,
  sanitizeQuery,
  sanitizeParams,
  sanitizeAll,
};

