module.exports.recalculateCreditScore = async ({
  currentScore = 500,
  wasPaymentLate,
  daysLate
}) => {
  let scoreDelta = 0;

  if (!wasPaymentLate) scoreDelta = +2;
  else if (daysLate <= 3) scoreDelta = -5;
  else if (daysLate <= 7) scoreDelta = -10;
  else scoreDelta = -20;

  let newScore = currentScore + scoreDelta;

  // clamp score between 0 and 1000
  newScore = Math.max(0, Math.min(1000, newScore));

  return {
    scoreDelta,
    newScore
  };
};
