const { getMaxLoanAmount, evaluateLoanByCreditScore: newEvaluateLoanByCreditScore } = require("./creditScore");

/**
 * Legacy wrapper for loan eligibility.
 * Redirects to the modern professional credit engine.
 */
module.exports.evaluateLoanByCreditScore = ({
  creditScore = 500,
  requestedAmount = 0,
  borrower,
  repaymentRatio = 1
}) => {
  return newEvaluateLoanByCreditScore({
    creditScore,
    requestedAmount,
    borrower
  });
};

/**
 * 🆕 Standalone getMaxLoanAmount helper
 * Uses the latest professional scoring rules.
 */
module.exports.getMaxLoanAmount = (customer) => {
  return getMaxLoanAmount(customer);
};