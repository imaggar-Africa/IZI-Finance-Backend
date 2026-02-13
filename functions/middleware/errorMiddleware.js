// middleware/errorMiddleware.js
const Joi = require("joi");
const { formatValidationError } = require("./validationMiddleware");

/**
 * Global Error Handler Middleware
 * Handles various types of errors including validation errors
 */
const errorHandler = (err, req, res, next) => {
  // Joi Validation Error
  if (err.isJoi) {
    const validationError = formatValidationError(err);
    return res.status(400).json(validationError);
  }

  // Mongoose Validation Error
  if (err.name === "ValidationError") {
    const errors = Object.keys(err.errors).map((key) => ({
      field: key,
      message: err.errors[key].message,
    }));

    return res.status(400).json({
      success: false,
      message: "Validation error",
      errors,
    });
  }

  // Mongoose Cast Error (Invalid ObjectId, etc.)
  if (err.name === "CastError") {
    return res.status(400).json({
      success: false,
      message: "Invalid ID format",
      error: err.message,
    });
  }

  // MongoDB Duplicate Key Error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(409).json({
      success: false,
      message: `${field} already exists`,
      field,
    });
  }

  // JWT Errors
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      message: "Invalid token",
    });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      message: "Token expired",
    });
  }

  // Rate Limit Error
  if (err.status === 429) {
    return res.status(429).json({
      success: false,
      message: err.message || "Too many requests, please try again later",
    });
  }

  // Default Error
  const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : err.statusCode || 500;

  // Log error for debugging
  console.error("🔥 Error:", {
    message: err.message,
    stack: process.env.NODE_ENV !== "production" ? err.stack : undefined,
    url: req.originalUrl,
    method: req.method,
  });

  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
};

/**
 * 404 Not Found Handler
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: "API Route Not Found",
    path: req.originalUrl,
  });
};

module.exports = {
  errorHandler,
  notFoundHandler,
};
  