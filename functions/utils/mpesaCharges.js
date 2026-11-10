exports.getB2CCharge = (amount) => {
  const amt = Number(amount);
  if (isNaN(amt) || amt < 1) return 0;

  // Continuous slabs to prevent floating-point gaps
  if (amt <= 100) return 0;
  if (amt <= 1500) return 6;
  if (amt <= 5000) return 10;
  if (amt <= 20000) return 13;
  if (amt <= 250000) return 15; // Covers up to the maximum M-Pesa limit

  return 0; // fallback safety
};
