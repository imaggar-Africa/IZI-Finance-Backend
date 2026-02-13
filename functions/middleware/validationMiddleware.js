const Joi = require("joi");

/**
 * =========================
 * VALIDATION MIDDLEWARE FACTORY
 * =========================
 * Creates Express middleware that validates request data using Joi schemas
 */

/**
 * Validate request data (body, query, or params) using a Joi schema
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {Object} options - Validation options
 * @param {string} options.source - Where to validate: 'body' (default), 'query', or 'params'
 * @param {boolean} options.abortEarly - Stop validation on first error (default: false)
 * @param {boolean} options.stripUnknown - Remove unknown fields (default: true)
 * @returns {Function} Express middleware function
 */
const validate = (schema, options = {}) => {
  const {
    source = "body", // 'body', 'query', or 'params'
    abortEarly = false, // Show all validation errors
    stripUnknown = true, // Remove unknown fields
  } = options;

  return (req, res, next) => {
    // Get data from the specified source
    const data = req[source];

    // Validate the data
    const { error, value } = schema.validate(data, {
      abortEarly,
      stripUnknown,
      allowUnknown: !stripUnknown, // Allow unknown fields if not stripping
    });

    if (error) {
      // Format validation errors
      const errors = error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
        value: detail.context?.value,
      }));

      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors,
      });
    }

    // Replace the original data with validated (and potentially sanitized) data
    req[source] = value;

    next();
  };
};

/**
 * Validate request body
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {Object} options - Validation options
 * @returns {Function} Express middleware function
 */
const validateBody = (schema, options = {}) => {
  return validate(schema, { ...options, source: "body" });
};

/**
 * Validate request query parameters
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {Object} options - Validation options
 * @returns {Function} Express middleware function
 */
const validateQuery = (schema, options = {}) => {
  return validate(schema, { ...options, source: "query" });
};

/**
 * Validate request route parameters
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {Object} options - Validation options
 * @returns {Function} Express middleware function
 */
const validateParams = (schema, options = {}) => {
  return validate(schema, { ...options, source: "params" });
};

/**
 * Validate multiple sources at once
 * @param {Object} schemas - Object with schema for each source
 * @param {Joi.Schema} schemas.body - Schema for req.body
 * @param {Joi.Schema} schemas.query - Schema for req.query
 * @param {Joi.Schema} schemas.params - Schema for req.params
 * @param {Object} options - Validation options
 * @returns {Function} Express middleware function
 */
const validateMultiple = (schemas, options = {}) => {
  return (req, res, next) => {
    const errors = [];

    // Validate body if schema provided
    if (schemas.body) {
      const { error, value } = schemas.body.validate(req.body, {
        abortEarly: false,
        stripUnknown: options.stripUnknown !== false,
      });
      if (error) {
        errors.push(
          ...error.details.map((detail) => ({
            source: "body",
            field: detail.path.join("."),
            message: detail.message,
          }))
        );
      } else {
        req.body = value;
      }
    }

    // Validate query if schema provided
    if (schemas.query) {
      const { error, value } = schemas.query.validate(req.query, {
        abortEarly: false,
        stripUnknown: options.stripUnknown !== false,
      });
      if (error) {
        errors.push(
          ...error.details.map((detail) => ({
            source: "query",
            field: detail.path.join("."),
            message: detail.message,
          }))
        );
      } else {
        req.query = value;
      }
    }

    // Validate params if schema provided
    if (schemas.params) {
      const { error, value } = schemas.params.validate(req.params, {
        abortEarly: false,
        stripUnknown: options.stripUnknown !== false,
      });
      if (error) {
        errors.push(
          ...error.details.map((detail) => ({
            source: "params",
            field: detail.path.join("."),
            message: detail.message,
          }))
        );
      } else {
        req.params = value;
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors,
      });
    }

    next();
  };
};

/**
 * Custom validation error handler
 * Formats Joi validation errors for consistent API responses
 */
const formatValidationError = (error) => {
  if (!error || !error.details) {
    return {
      success: false,
      message: "Validation error",
      errors: [],
    };
  }

  const errors = error.details.map((detail) => ({
    field: detail.path.join("."),
    message: detail.message,
    value: detail.context?.value,
  }));

  return {
    success: false,
    message: "Validation error",
    errors,
  };
};

module.exports = {
  validate,
  validateBody,
  validateQuery,
  validateParams,
  validateMultiple,
  formatValidationError,
};

