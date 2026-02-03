// module.exports.evaluateLoanByCreditScore = ({
//   creditScore = 500,
//   requestedAmount
// }) => {
//   // ❌ Block low score
//   if (creditScore < 600) {
//     return {
//       allowed: false,
//       reason: "Low credit score"
//     };
//   }

//   // ✅ High score → increase limit
//   if (creditScore >= 800) {
//     return {
//       allowed: true,
//       approvedAmount: Math.round(requestedAmount * 1.2), // +20%
//       note: "High credit score bonus applied"
//     };
//   }

//   // ✅ Normal approval
//   return {
//     allowed: true,
//     approvedAmount: requestedAmount,
//     note: "Normal approval"
//   };
// };

module.exports.evaluateLoanByCreditScore = ({
  creditScore = 500,
  requestedAmount = 0,
  borrower
}) => {

  // 🛑 safety
  if (!borrower) {
    return { allowed: false, approvedAmount: 0 };
  }

  const totalLoans = Number(borrower.totalLoans || 0);
  const completedLoans = Number(borrower.completedLoans || 0);

  console.log("🧪 CREDIT CHECK", {
    creditScore,
    totalLoans,
    completedLoans,
    requestedAmount
  });

  // 🟢 FIRST TIME CUSTOMER → STARTER LOAN
  if (totalLoans === 0 && completedLoans === 0) {
    const starterLimit = 1000;

    return {
      allowed: requestedAmount <= starterLimit,
      approvedAmount: starterLimit,
      reason: "Starter loan for new customer"
    };
  }

  // 🔴 HARD BLOCK
  if (creditScore < 500) {
    return {
      allowed: false,
      approvedAmount: 0,
      reason: "Credit score too low"
    };
  }

  // 🔴 HIGH RISK
  if (creditScore < 600) {
    return {
      allowed: false,
      approvedAmount: 0,
      reason: "High risk borrower"
    };
  }

  // 🟡 LOW
  if (creditScore < 650) {
    return { allowed: true, approvedAmount: 2000 };
  }

  // 🟢 MEDIUM
  if (creditScore < 700) {
    return { allowed: true, approvedAmount: 5000 };
  }

  // 🟢 GOOD
  if (creditScore < 750) {
    return { allowed: true, approvedAmount: 8000 };
  }

  // ⭐ EXCELLENT
  return { allowed: true, approvedAmount: 15000 };
};
