/* ======================================================
   IZI FINANCE PROFESSIONAL CREDIT ENGINE (MODERNIZED)
====================================================== */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * 1️⃣ RISK MULTIPLIER LOGIC
 * Calculates a multiplier based on repayment behavior.
 */
const getRiskMultiplier = (customer) => {
  let multiplier = 1.0;

  const latePayments = Number(customer.latePayments || 0);
  const totalLoans = Number(customer.totalLoansTaken || customer.totalLoans || 0);
  const totalRepaid = Number(customer.totalLoansRepaid || customer.completedLoans || 0);

  // Late payment penalties
  if (latePayments >= 3) multiplier -= 0.3;
  if (latePayments >= 5) multiplier -= 0.2;

  // Repayment rate penalty
  if (totalLoans > 0) {
    const repaymentRate = totalRepaid / totalLoans;
    if (repaymentRate < 0.7) multiplier -= 0.3;
  }

  return Math.max(0.4, multiplier);
};

/**
 * 2️⃣ MAXIMUM LOAN AMOUNT LOGIC
 */
const getMaxLoanAmount = (customer) => {
  return 500; 
};

/**
 * 3️⃣ CREDIT LEVEL UPDATE
 */
const updateCreditLevel = (customer) => {
  const score = Number(customer.creditScore || 500);

  if (score < 600) return "High Risk";
  if (score < 700) return "Medium Risk";
  return "Low Risk";
};

/**
 * 4️⃣ CREDIT SCORE UPDATE
 */
const updateCreditScore = (customer, delta, reason) => {
  const oldScore = Number(customer.creditScore || 500);
  const newScore = clamp(oldScore + delta, 300, 900);

  customer.creditScore = newScore;
  customer.lastScoreUpdate = new Date();
  customer.lastCreditScoreChange = {
    delta: newScore - oldScore,
    reason: reason || "System update",
    date: new Date(),
  };

  customer.creditLevel = updateCreditLevel(customer);
  customer.maxLoanLimit = getMaxLoanAmount(customer);

  return { newScore, delta: newScore - oldScore };
};

/**
 * 5️⃣ REPAYMENT PROCESSING LOGIC
 * Determines the score change based on repayment behavior.
 */
const getRepaymentScoreDelta = (loan, customer, paymentAmount, paymentDate) => {
  const now = paymentDate || new Date();
  const issueDate = new Date(loan.issueDate);
  const dueDate = new Date(loan.dueDate);

  // Duration check: if repaid too fast (< 2 days), ignore scoring.
  const diffDays = (now - issueDate) / (1000 * 60 * 60 * 24);
  if (diffDays < 2) return 0;

  const isLate = now > dueDate;
  const isFullRepayment = (loan.balance || 0) <= paymentAmount;

  if (!isLate && isFullRepayment) {
    const totalRepaid = Number(customer.totalLoansRepaid || customer.completedLoans || 0);
    return totalRepaid < 3 ? 20 : 10;
  }

  if (!isLate && !isFullRepayment) {
    return 3;
  }

  if (isLate) {
    const daysLate = Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24));
    const penalty = Math.min(50, daysLate * 2);
    return -penalty;
  }

  return 0;
};

/**
 * 6️⃣ SCORE RECOVERY SYSTEM
 * Increase score if 30 days passed and no late payments.
 */
const applyScoreRecovery = async (customer) => {
  const now = new Date();
  const lastUpdate = customer.lastScoreUpdate || customer.createdAt;
  const daysSinceLastUpdate = (now - lastUpdate) / (1000 * 60 * 60 * 24);

  const latePayments = Number(customer.latePayments || 0);

  if (daysSinceLastUpdate >= 30 && latePayments === 0) {
    updateCreditScore(customer, 5, "Score recovery (30 days good standing)");
    await customer.save();
    return true;
  }
  return false;
};

// --- LEGACY ADAPTERS (Used to avoid breaking existing code) ---

const recalculateCreditScore = ({ currentScore, event, daysLate }) => {
  // Mapping event to delta for backward compatibility
  let delta = 0;
  if (event === "ON_TIME") delta = 10;
  else if (event === "LATE") delta = -Math.min(50, daysLate * 2);

  const newScore = clamp(currentScore + delta, 300, 900);
  return { newScore, scoreDelta: newScore - currentScore };
};

const evaluateLoanByCreditScore = ({ creditScore, requestedAmount, borrower }) => {
  return {
    allowed: true,
    approvedAmount: 500,
    reason: "Default limit applied",
  };
};

/* ======================================================
   EXPORTS
===================================================== */
module.exports = {
  getRiskMultiplier,
  getMaxLoanAmount,
  updateCreditLevel,
  updateCreditScore,
  getRepaymentScoreDelta,
  applyScoreRecovery,
  recalculateCreditScore,
  evaluateLoanByCreditScore,
  calculateDefaultProbability: (score) => 1 - (score / 900)
};