module.exports.evaluateLoanByCreditScore = ({
  creditScore = 500,
  requestedAmount = 0,
  borrower
}) => {

  // 🛑 SAFETY
  if (!borrower) {
    return {
      allowed: false,
      approvedAmount: 0,
      reason: "Borrower data missing"
    };
  }

  // 🟢 FIRST LOAN OVERRIDE (VERY IMPORTANT)
  if (
    Number(borrower.totalLoans || 0) === 0 &&
    Number(borrower.completedLoans || 0) === 0
  ) {
    const starterLimit = 1000;

    return {
      allowed: requestedAmount <= starterLimit,
      approvedAmount: starterLimit,
      reason: "Starter loan for new customer"
    };
  }

  // 🔴 BLOCK
  if (creditScore < 600) {
    return { allowed: false, approvedAmount: 0 };
  }

  if (creditScore < 650) {
    return { allowed: true, approvedAmount: 2000 };
  }

  if (creditScore < 700) {
    return { allowed: true, approvedAmount: 5000 };
  }

  if (creditScore < 750) {
    return { allowed: true, approvedAmount: 8000 };
  }

  return { allowed: true, approvedAmount: 15000 };
};
