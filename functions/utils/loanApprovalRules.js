module.exports.evaluateLoanByCreditScore = ({
  creditScore = 500,
  requestedAmount
}) => {
  // ❌ Block low score
  if (creditScore < 600) {
    return {
      allowed: false,
      reason: "Low credit score"
    };
  }

  // ✅ High score → increase limit
  if (creditScore >= 800) {
    return {
      allowed: true,
      approvedAmount: Math.round(requestedAmount * 1.2), // +20%
      note: "High credit score bonus applied"
    };
  }

  // ✅ Normal approval
  return {
    allowed: true,
    approvedAmount: requestedAmount,
    note: "Normal approval"
  };
};
