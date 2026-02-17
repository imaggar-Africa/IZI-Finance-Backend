// // module.exports.evaluateLoanByCreditScore = ({
// //   creditScore = 500,
// //   requestedAmount = 0,
// //   borrower
// // }) => {

// //   // 🛑 SAFETY
// //   if (!borrower) {
// //     return {
// //       allowed: false,
// //       approvedAmount: 0,
// //       reason: "Borrower data missing"
// //     };
// //   }

// //   // 🟢 FIRST LOAN OVERRIDE (VERY IMPORTANT)
// //   if (
// //     Number(borrower.totalLoans || 0) === 0 &&
// //     Number(borrower.completedLoans || 0) === 0
// //   ) {
// //     const starterLimit = 1000;

// //     return {
// //       allowed: requestedAmount <= starterLimit,
// //       approvedAmount: starterLimit,
// //       reason: "Starter loan for new customer"
// //     };
// //   }

// //   // 🔴 BLOCK
// //   if (creditScore < 600) {
// //     return { allowed: false, approvedAmount: 0 };
// //   }

// //   if (creditScore < 650) {
// //     return { allowed: true, approvedAmount: 2000 };
// //   }

// //   if (creditScore < 700) {
// //     return { allowed: true, approvedAmount: 5000 };
// //   }

// //   if (creditScore < 750) {
// //     return { allowed: true, approvedAmount: 8000 };
// //   }

// //   return { allowed: true, approvedAmount: 15000 };
// // };

// /* ======================================================
//    CREDIT SCORE – REPAYMENT UPDATE
// ====================================================== */
// const recalculateCreditScore = ({
//   currentScore = 500,
//   event = "ON_TIME",
//   daysLate = 0
// }) => {
//   let scoreDelta = 0;

//   if (event === "ON_TIME") {
//     scoreDelta = +10;
//   }

//   if (event === "LATE") {
//     scoreDelta = -Math.min(50, daysLate * 2);
//   }

//   const newScore = Math.max(300, Math.min(900, currentScore + scoreDelta));

//   return {
//     newScore,
//     scoreDelta
//   };
// };

// /* ======================================================
//    LOAN ELIGIBILITY – EXISTING FLOW (UNCHANGED)
// ====================================================== */
// const evaluateLoanByCreditScore = ({
//   creditScore = 500,
//   requestedAmount = 0,
//   borrower
// }) => {

//   if (!borrower) {
//     return {
//       allowed: false,
//       approvedAmount: 0,
//       reason: "Borrower data missing"
//     };
//   }

//   // 🟢 FIRST LOAN OVERRIDE
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

// /* ======================================================
//    EXPORTS (IMPORTANT)
// ====================================================== */
// module.exports = {
//   recalculateCreditScore,
//   evaluateLoanByCreditScore
// };


/* ======================================================
   IZIBANK PROFESSIONAL CREDIT ENGINE
====================================================== */

const clamp = (value, min, max) =>
  Math.max(min, Math.min(max, value));

/* ======================================================
   DEFAULT PROBABILITY
====================================================== */
const calculateDefaultProbability = (creditScore) => {
  const probability = 1 - (creditScore / 900);
  return Number(probability.toFixed(2));
};

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
    scoreDelta = 10;
  }

  if (event === "LATE") {
    scoreDelta = -Math.min(50, daysLate * 2);
  }

  const newScore = clamp(currentScore + scoreDelta, 300, 900);

  return {
    newScore,
    scoreDelta
  };
};

/* ======================================================
   LOAN ELIGIBILITY – ADVANCED RISK MODEL
====================================================== */
const evaluateLoanByCreditScore = ({
  creditScore = 500,
  requestedAmount = 0,
  borrower,
  repaymentRatio = 1,
  exposureRatio = 0
}) => {

  if (!borrower) {
    return {
      allowed: false,
      approvedAmount: 0,
      reason: "Borrower data missing"
    };
  }

  repaymentRatio = Number(repaymentRatio) || 1;
  exposureRatio = Number(exposureRatio) || 0;

  /* ===========================
     1️⃣ STARTER OVERRIDE
  =========================== */
  if (
    Number(borrower.totalLoans || 0) === 0 &&
    Number(borrower.completedLoans || 0) === 0
  ) {
    const starterLimit = 1000;

    return {
      allowed: requestedAmount <= starterLimit,
      approvedAmount: starterLimit,
      riskLevel: "NEW_CUSTOMER",
      defaultProbability: calculateDefaultProbability(creditScore),
      reason: "Starter loan"
    };
  }

  const defaultProbability =
    calculateDefaultProbability(creditScore);

  /* ===========================
     2️⃣ RISK CLASSIFICATION
  =========================== */
  let riskLevel = "LOW";

  if (
    defaultProbability > 0.40 ||
    exposureRatio > 0.60 ||
    repaymentRatio < 0.65
  ) {
    riskLevel = "HIGH";
  } else if (
    defaultProbability > 0.30 ||
    exposureRatio > 0.45 ||
    repaymentRatio < 0.75
  ) {
    riskLevel = "MEDIUM";
  }

  /* ===========================
     3️⃣ HARD BLOCK
  =========================== */
  if (defaultProbability > 0.45) {
    return {
      allowed: false,
      approvedAmount: 0,
      riskLevel,
      defaultProbability,
      reason: "High default probability"
    };
  }

  /* ===========================
     4️⃣ CREDIT BAND APPROVAL
  =========================== */
  let approvedAmount = 0;

  if (creditScore < 600) {
    return {
      allowed: false,
      approvedAmount: 0,
      riskLevel,
      defaultProbability,
      reason: "Low credit score"
    };
  }

  if (creditScore < 650)
    approvedAmount = 2000;
  else if (creditScore < 700)
    approvedAmount = 5000;
  else if (creditScore < 750)
    approvedAmount = 8000;
  else
    approvedAmount = 15000;

  /* ===========================
     5️⃣ RISK BASED REDUCTION
  =========================== */
  if (riskLevel === "HIGH") {
    approvedAmount = approvedAmount * 0.5; // 50% reduction
  }

  if (riskLevel === "MEDIUM") {
    approvedAmount = approvedAmount * 0.75; // 25% reduction
  }

  return {
    allowed: requestedAmount <= approvedAmount,
    approvedAmount: Math.round(approvedAmount),
    riskLevel,
    defaultProbability
  };
};


/* ======================================================
   EXPORTS
====================================================== */
module.exports = {
  recalculateCreditScore,
  evaluateLoanByCreditScore,
  calculateDefaultProbability
};
  