// utils/normalizePhone.js

exports.normalizePhone = (phone) => {
  if (!phone) return null;

  const cleaned = phone.replace(/\s+/g, "");

  const patterns = [
    /^\+254\d{9}$/,  // Kenya
    /^\+256\d{9}$/,  // Uganda
    /^\+255\d{9}$/,  // Tanzania
    /^\+250\d{9}$/,  // Rwanda
    /^\+234\d{10}$/,  // Nigeria
    /^\+233\d{9}$/    // Ghana
  ];

  return patterns.some((r) => r.test(cleaned)) ? cleaned : null;
};
