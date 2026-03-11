
// module.exports.evaluateLoanByCreditScore = ({
//   creditScore = 500,
//   requestedAmount = 0,
//   borrower
// }) => {

//   // 🛑 safety
//   if (!borrower) {
//     return { allowed: false, approvedAmount: 0 };
//   }

//   const totalLoans = Number(borrower.totalLoans || 0);
//   const completedLoans = Number(borrower.completedLoans || 0);

//   console.log("🧪 CREDIT CHECK", {
//     creditScore,
//     totalLoans,
//     completedLoans,
//     requestedAmount
//   });

//   // 🟢 FIRST TIME CUSTOMER → STARTER LOAN
//   if (totalLoans === 0 && completedLoans === 0) {
//     const starterLimit = 1000;

//     return {
//       allowed: requestedAmount <= starterLimit,
//       approvedAmount: starterLimit,
//       reason: "Starter loan for new customer"
//     };
//   }

//   // 🔴 HARD BLOCK
//   if (creditScore < 500) {
//     return {
//       allowed: false,
//       approvedAmount: 0,
//       reason: "Credit score too low"
//     };
//   }

//   // 🔴 HIGH RISK
//   if (creditScore < 600) {
//     return {
//       allowed: false,
//       approvedAmount: 0,
//       reason: "High risk borrower"
//     };
//   }

//   // 🟡 LOW
//   if (creditScore < 650) {
//     return { allowed: true, approvedAmount: 2000 };
//   }

//   // 🟢 MEDIUM
//   if (creditScore < 700) {
//     return { allowed: true, approvedAmount: 5000 };
//   }

//   // 🟢 GOOD
//   if (creditScore < 750) {
//     return { allowed: true, approvedAmount: 8000 };
//   }

//   // ⭐ EXCELLENT
//   return { allowed: true, approvedAmount: 15000 };
// };

module.exports.evaluateLoanByCreditScore = ({
  creditScore = 500,
  requestedAmount = 0,
  borrower,
  repaymentRatio = 1
}) => {

  if (!borrower) {
    return { allowed: false, approvedAmount: 0 };
  }

  const totalLoans = Number(borrower.totalLoans || 0);
  const completedLoans = Number(borrower.completedLoans || 0);
  const overdueLoans = Number(borrower.overdueLoans || 0);

  /* =========================================
     1️⃣ STARTER LOAN
  ========================================= */
  if (totalLoans === 0) {
    const starterLimit = 1000;

    return {
      allowed: requestedAmount <= starterLimit,
      approvedAmount: starterLimit,
      reason: "New customers are eligible for a starter loan up to KES 1,000. Please adjust the loan amount to proceed."
    };
  }

  /* =========================================
     2️⃣ HARD BLOCK (Bad Behaviour Only)
  ========================================= */
  if (overdueLoans > 0) {
    return {
      allowed: false,
      approvedAmount: 0,
      reason: "Has overdue history"
    };
  }

  /* =========================================
     3️⃣ BEHAVIOR-BASED PROGRESSIVE LOAN
  ========================================= */
  if (
    completedLoans >= 1 &&
    repaymentRatio >= 1   // fully paid on time
  ) {
    return {
      allowed: requestedAmount <= 2000,
      approvedAmount: 2000,
      reason: "Progressive loan after good repayment"
    };
  }

  /* =========================================
     4️⃣ CREDIT BAND (Fallback)
  ========================================= */

  if (creditScore < 550) {
    return { allowed: false, approvedAmount: 0 };
  }

  if (creditScore < 650) {
    return { allowed: true, approvedAmount: 3000 };
  }

  if (creditScore < 700) {
    return { allowed: true, approvedAmount: 5000 };
  }

  return { allowed: true, approvedAmount: 10000 };
};