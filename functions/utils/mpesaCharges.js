exports.getB2CCharge = (amount) => {
  // Zero charge slabs
  if (amount >= 1 && amount <= 49) return 0;
  if (amount >= 50 && amount <= 100) return 0;

  // Original charge = 5 → Increased = 6
  if (amount >= 101 && amount <= 500) return 6;
  if (amount >= 501 && amount <= 1000) return 6;
  if (amount >= 1001 && amount <= 1500) return 6;

  // Original charge = 9 → Increased = 10
  if (amount >= 1501 && amount <= 2500) return 10;
  if (amount >= 2501 && amount <= 3500) return 10;
  if (amount >= 3501 && amount <= 5000) return 10;

  // Original charge = 11 → Increased = 13
  if (amount >= 5001 && amount <= 7500) return 13;
  if (amount >= 7501 && amount <= 10000) return 13;
  if (amount >= 10001 && amount <= 15000) return 13;
  if (amount >= 15001 && amount <= 20000) return 13;

  // Original charge = 13 → Increased = 15
  if (amount >= 20001 && amount <= 25000) return 15;
  if (amount >= 25001 && amount <= 30000) return 15;
  if (amount >= 30001 && amount <= 35000) return 15;
  if (amount >= 35001 && amount <= 40000) return 15;
  if (amount >= 40001 && amount <= 45000) return 15;
  if (amount >= 45001 && amount <= 50000) return 15;
  if (amount >= 50001 && amount <= 70000) return 15;
  if (amount >= 70001 && amount <= 150000) return 15;

  return 0; // fallback safety
};
