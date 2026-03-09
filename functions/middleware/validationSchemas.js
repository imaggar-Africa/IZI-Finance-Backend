const Joi = require("joi");
const mongoose = require("mongoose");

/**
 * =========================
 * COMMON VALIDATION SCHEMAS
 * =========================
 */

// Phone number schema - African phone numbers
const phoneSchema = Joi.string()
  .pattern(/^\+2547\d{8}$|^\+2567\d{8}$|^\+2557\d{8}$|^\+2507\d{8}$|^\+234\d{10}$|^\+233\d{9}$/)
  .required()
  .messages({
    "string.pattern.base":
      "Invalid phone format. Supported: Kenya (+254), Uganda (+256), Tanzania (+255), Rwanda (+250), Nigeria (+234), Ghana (+233)",
  });

// Email schema
const emailSchema = Joi.string().email().required().messages({
  "string.email": "Invalid email format",
});

// Password schema - minimum 6 characters
const passwordSchema = Joi.string().min(6).required().messages({
  "string.min": "Password must be at least 6 characters long",
});

// Amount schema - positive number
const amountSchema = Joi.number().positive().required().messages({
  "number.positive": "Amount must be a positive number",
  "number.base": "Amount must be a valid number",
});

// MongoDB ObjectId schema
const idSchema = Joi.string()
  .custom((value, helpers) => {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      return helpers.error("any.invalid");
    }
    return value;
  })
  .required()
  .messages({
    "any.invalid": "Invalid ID format",
  });

// Date schema
const dateSchema = Joi.date().iso().messages({
  "date.format": "Date must be in ISO format (YYYY-MM-DD)",
});

// OTP schema - 4-6 digit code
const otpSchema = Joi.string()
  .pattern(/^\d{4,6}$/)
  .required()
  .messages({
    "string.pattern.base": "OTP must be 4-6 digits",
  });

// Name schema
const nameSchema = Joi.string().trim().min(2).max(100).required().messages({
  "string.min": "Name must be at least 2 characters",
  "string.max": "Name must not exceed 100 characters",
});

// ID Number schema
const idNumberSchema = Joi.string().trim().min(5).max(20).required().messages({
  "string.min": "ID number must be at least 5 characters",
  "string.max": "ID number must not exceed 20 characters",
});

// Gender schema
const genderSchema = Joi.string().valid("male", "female", "other").messages({
  "any.only": "Gender must be one of: male, female, other",
});

// Marital status schema
const maritalStatusSchema = Joi.string()
  .valid("single", "married", "divorced", "widowed")
  .messages({
    "any.only": "Marital status must be one of: single, married, divorced, widowed",
  });

// Role schema
const roleSchema = Joi.string().valid("lender", "agent", "borrower", "admin").messages({
  "any.only": "Role must be one of: lender, agent, borrower, admin",
});

/**
 * =========================
 * AUTHENTICATION SCHEMAS
 * =========================
 */

// Register schema - Step 1: Send OTP
const authRegisterSchema = Joi.object({
  phone: phoneSchema,
  password: passwordSchema,
});

// Verify phone & create account schema - Step 2
const authVerifyPhoneSchema = Joi.object({
  phone: phoneSchema,
  otp: otpSchema,
  password: passwordSchema,
});

// Login schema
const authLoginSchema = Joi.object({
  phone: phoneSchema,
  password: passwordSchema,
});

// Refresh token schema
const authRefreshSchema = Joi.object({
  refreshToken: Joi.string().required().messages({
    "any.required": "Refresh token is required",
  }),
});

// Forgot password schema
const authForgotPasswordSchema = Joi.object({
  phone: phoneSchema,
});

// Reset password schema
const authResetPasswordSchema = Joi.object({
  phone: phoneSchema,
  otp: otpSchema,
  newPassword: passwordSchema,
});

// Send verification code schema
const authSendVerificationCodeSchema = Joi.object({
  phone: phoneSchema,
});

// Upload ID verification schema
const authUploadIdVerificationSchema = Joi.object({
  fullName: nameSchema,
  idNumber: idNumberSchema,
}).unknown(true); // Allow file uploads

/**
 * =========================
 * CUSTOMER/BORROWER SCHEMAS
 * =========================
 */

// Customer registration schema
const customerRegisterSchema = Joi.object({
  fullName: nameSchema,
  phone: phoneSchema,
  email: emailSchema.optional(),
  idNumber: idNumberSchema,
  dateOfBirth: dateSchema.optional(),
  gender: genderSchema.optional(),
  maritalStatus: maritalStatusSchema.optional(),
  altPhoneNumber: phoneSchema.optional(),
  physicalAddress: Joi.string().trim().max(500).optional(),
  gpsLocation: Joi.object({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
  }).optional(),
  occupation: Joi.string().trim().max(100).optional(),
  monthlyIncomeRange: Joi.string().trim().optional(),
  nextOfKinName: nameSchema.optional(),
  nextOfKinPhone: phoneSchema.optional(),
  preferredMobileMoney: Joi.string().trim().optional(),
  savingsGoal: Joi.number().min(0).optional(),
  loanConsent: Joi.boolean().optional(),
  agreementAcceptance: Joi.boolean().optional(),
  preferences: Joi.object().optional(),
  savingsBalance: Joi.number().min(0).optional(),
  kraPin: Joi.string().trim().max(20).optional(),
  educationLevel: Joi.string().trim().optional(),
  householdSize: Joi.number().integer().min(1).optional(),
  loanPurpose: Joi.string().trim().optional(),
  deviceType: Joi.string().trim().optional(),
  referralSource: Joi.string().trim().optional(),
  referredByBorrowerId: idSchema.optional(),
  guarantor: Joi.object().optional(),
}).unknown(true); // Allow file uploads

// Update borrower profile schema
const borrowerUpdateProfileSchema = Joi.object({
  fullName: nameSchema.optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  altPhoneNumber: phoneSchema.optional(),
  physicalAddress: Joi.string().trim().max(500).optional(),
  occupation: Joi.string().trim().max(100).optional(),
  monthlyIncomeRange: Joi.string().trim().optional(),
  nextOfKinName: nameSchema.optional(),
  nextOfKinPhone: phoneSchema.optional(),
  savingsGoal: Joi.number().min(0).optional(),
}).unknown(true); // Allow file uploads

/**
 * =========================
 * LOAN SCHEMAS
 * =========================
 */

// Issue loan schema
const loanIssueSchema = Joi.object({
  borrowerId: idSchema,
  amount: amountSchema,
  totalInterest: amountSchema,
  duration: Joi.number().integer().positive().required().messages({
    "number.positive": "Duration must be a positive number",
    "number.base": "Duration must be a valid number",
  }),
  repaymentFrequency: Joi.string()
    .valid("daily", "weekly", "biweekly", "monthly")
    .required()
    .messages({
      "any.only": "Repayment frequency must be one of: daily, weekly, biweekly, monthly",
    }),
  phoneNumber: phoneSchema,
});

// Request loan schema (Agent)
const loanRequestSchema = Joi.object({
  borrowerId: idSchema,
  amount: amountSchema,
  duration: Joi.number().integer().positive().required(),
  repaymentFrequency: Joi.string()
    .valid("daily", "weekly", "biweekly", "monthly")
    .required(),
  purpose: Joi.string().trim().max(500).optional(),
});

// Review loan request schema (Lender)
const loanReviewSchema = Joi.object({
  loanRequestId: idSchema,
  action: Joi.string().valid("approve", "reject").required().messages({
    "any.only": "Action must be either 'approve' or 'reject'",
  }),
  approvedAmount: amountSchema.when("action", {
    is: "approve",
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  totalInterest: amountSchema.when("action", {
    is: "approve",
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  notes: Joi.string().trim().max(1000).optional(),
});

// Track repayment schema
const loanRepaymentSchema = Joi.object({
  loanId: idSchema,
  amount: amountSchema,
  phoneNumber: phoneSchema.optional(),
  paymentMethod: Joi.string()
    .valid("mpesa", "airtel", "mtn", "other")
    .optional(),
});

// Get active loans by phone schema
const loanGetActiveByPhoneSchema = Joi.object({
  phoneNumber: phoneSchema,
});

/**
 * =========================
 * WALLET SCHEMAS
 * =========================
 */

// Wallet deposit schema
const walletDepositSchema = Joi.object({
  amount: amountSchema,
});

// Wallet withdraw schema
const walletWithdrawSchema = Joi.object({
  amount: amountSchema,
});

// Customer deposit savings schema
const walletCustomerDepositSchema = Joi.object({
  amount: amountSchema,
});

// Customer withdraw savings schema
const walletCustomerWithdrawSchema = Joi.object({
  amount: amountSchema,
});

// Agent withdrawal request schema
const walletAgentWithdrawSchema = Joi.object({
  amount: amountSchema,
  reason: Joi.string().trim().max(500).optional(),
});

// Review agent withdrawal schema
const walletReviewAgentWithdrawSchema = Joi.object({
  withdrawalId: idSchema,
  action: Joi.string().valid("approve", "reject").required().messages({
    "any.only": "Action must be either 'approve' or 'reject'",
  }),
  reason: Joi.string().trim().max(500).optional(),
});

// Send balance SMS schema
const walletSendBalanceSmsSchema = Joi.object({
  phone: phoneSchema,
});

/**
 * =========================
 * PROFILE SCHEMAS
 * =========================
 */

// Update lender profile schema
const profileUpdateLenderSchema = Joi.object({
  fullName: nameSchema.optional(),
  idNumber: idNumberSchema.optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
}).unknown(true); // Allow file uploads

/**
 * =========================
 * GUARANTOR SCHEMAS
 * =========================
 */

// Create guarantor schema
const guarantorCreateSchema = Joi.object({
  borrowerId: idSchema,
  fullName: nameSchema,
  phone: phoneSchema,
  email: emailSchema.optional(),
  idNumber: idNumberSchema,
  relationship: Joi.string().trim().max(50).optional(),
  physicalAddress: Joi.string().trim().max(500).optional(),
});

/**
 * =========================
 * NEXT OF KIN SCHEMAS
 * =========================
 */

// Create next of kin schema
const nextOfKinCreateSchema = Joi.object({
  borrowerId: idSchema,
  fullName: nameSchema,
  phone: phoneSchema,
  relationship: Joi.string().trim().max(50).optional(),
  physicalAddress: Joi.string().trim().max(500).optional(),
});

/**
 * =========================
 * EXPORTS
 * =========================
 */

module.exports = {
  // Common schemas
  phoneSchema,
  emailSchema,
  passwordSchema,
  amountSchema,
  idSchema,
  dateSchema,
  otpSchema,
  nameSchema,
  idNumberSchema,
  genderSchema,
  maritalStatusSchema,
  roleSchema,

  // Auth schemas
  authRegisterSchema,
  authVerifyPhoneSchema,
  authLoginSchema,
  authRefreshSchema,
  authForgotPasswordSchema,
  authResetPasswordSchema,
  authSendVerificationCodeSchema,
  authUploadIdVerificationSchema,

  // Customer schemas
  customerRegisterSchema,
  borrowerUpdateProfileSchema,

  // Loan schemas
  loanIssueSchema,
  loanRequestSchema,
  loanReviewSchema,
  loanRepaymentSchema,
  loanGetActiveByPhoneSchema,

  // Wallet schemas
  walletDepositSchema,
  walletWithdrawSchema,
  walletCustomerDepositSchema,
  walletCustomerWithdrawSchema,
  walletAgentWithdrawSchema,
  walletReviewAgentWithdrawSchema,
  walletSendBalanceSmsSchema,

  // Profile schemas
  profileUpdateLenderSchema,

  // Guarantor schemas
  guarantorCreateSchema,

  // Next of kin schemas
  nextOfKinCreateSchema,
};

