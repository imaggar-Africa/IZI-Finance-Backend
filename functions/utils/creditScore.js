// module.exports.evaluateLoanByCreditScore = ({
//   creditScore = 500,
//   requestedAmount = 0,
//   borrower
// }) => {

//   // 🛑 SAFETY
//   if (!borrower) {
//     return {
//       allowed: false,
//       approvedAmount: 0,
//       reason: "Borrower data missing"
//     };
//   }

//   // 🟢 FIRST LOAN OVERRIDE (VERY IMPORTANT)
//   if (
//     Number(borrower.totalLoans || 0) === 0 &&
//     Number(borrower.completedLoans || 0) === 0
//   ) {
//     const starterLimit = 1000;

//     return {
//       allowed: requestedAmount <= starterLimit,
//       approvedAmount: starterLimit,
//       reason: "Starter loan for new customer"
//     };
//   }

//   // 🔴 BLOCK
//   if (creditScore < 600) {
//     return { allowed: false, approvedAmount: 0 };
//   }

//   if (creditScore < 650) {
//     return { allowed: true, approvedAmount: 2000 };
//   }

//   if (creditScore < 700) {
//     return { allowed: true, approvedAmount: 5000 };
//   }

//   if (creditScore < 750) {
//     return { allowed: true, approvedAmount: 8000 };
//   }

//   return { allowed: true, approvedAmount: 15000 };
// };

/* ======================================================
   CREDIT SCORE – REPAYMENT UPDATE
====================================================== */
const recalculateCreditScore = ({
  currentScore = 500,
  event = "ON_TIME",
  daysLate = 0
}) => {
  let scoreDelta = 0;

  if (event === "ON_TIME") {
    scoreDelta = +10;
  }

  if (event === "LATE") {
    scoreDelta = -Math.min(50, daysLate * 2);
  }

  const newScore = Math.max(300, Math.min(900, currentScore + scoreDelta));

  return {
    newScore,
    scoreDelta
  };
};

/* ======================================================
   LOAN ELIGIBILITY – EXISTING FLOW (UNCHANGED)
====================================================== */
const evaluateLoanByCreditScore = ({
  creditScore = 500,
  requestedAmount = 0,
  borrower
}) => {

  if (!borrower) {
    return {
      allowed: false,
      approvedAmount: 0,
      reason: "Borrower data missing"
    };
  }

  // 🟢 FIRST LOAN OVERRIDE
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

/* ======================================================
   EXPORTS (IMPORTANT)
====================================================== */
module.exports = {
  recalculateCreditScore,
  evaluateLoanByCreditScore
};
