// utils/normalizePhone.js

exports.normalizePhone = (phone) => {
  if (!phone) return null;

  const cleaned = phone.replace(/\s+/g, "");

  const patterns = [
    /^\+2547\d{8}$/,  // Kenya
    /^\+2567\d{8}$/,  // Uganda
    /^\+2557\d{8}$/,  // Tanzania
    /^\+2507\d{8}$/,  // Rwanda
    /^\+234\d{10}$/,  // Nigeria
    /^\+233\d{9}$/    // Ghana
  ];

  return patterns.some((r) => r.test(cleaned)) ? cleaned : null;
};
