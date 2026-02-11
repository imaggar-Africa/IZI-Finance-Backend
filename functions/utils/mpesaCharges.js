exports.getB2CCharge = (amount) => {
  if (amount <= 100) return 0;
  if (amount <= 1500) return 5;
  if (amount <= 2500) return 9;
  if (amount <= 5000) return 9;
  if (amount <= 10000) return 11;
  if (amount <= 20000) return 11;
  return 13;
};
