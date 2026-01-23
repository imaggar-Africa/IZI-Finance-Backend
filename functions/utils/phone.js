/**
 * Phone normalization utility
 * Supports: KE, UG, TZ, RW, NG, GH
 * Output: E.164 format (+XXXXXXXXXXX)
 */

// E.164 validator
const E164 = /^\+[1-9]\d{1,14}$/;

exports.isE164 = (phone) => E164.test(phone);

/**
 * Normalize phone number to E.164
 * @param {string} raw
 * @returns {string|null}
 */
exports.normalizePhone = (raw) => {
  if (!raw) return null;

  let s = String(raw)
    .replace(/\s+/g, "")
    .replace(/\u200B/g, "")
    .replace(/\u00A0/g, "");

  if (!s) return null;

  // Already valid E.164
  if (s.startsWith("+") && E164.test(s)) {
    return s;
  }

  // Remove "+"
  s = s.replace(/^\+/, "");

  /* ---------------- KENYA ---------------- */
  if (s.startsWith("254") && s.length === 12) {
    return `+${s}`;
  }
  if (s.startsWith("07") && s.length === 10) {
    return `+254${s.slice(1)}`;
  }
  if (s.startsWith("7") && s.length === 9) {
    return `+254${s}`;
  }

  /* ---------------- UGANDA ---------------- */
  if (s.startsWith("256") && s.length === 12) {
    return `+${s}`;
  }
  if (s.startsWith("07") && s.length === 10) {
    return `+256${s.slice(1)}`;
  }

  /* ---------------- TANZANIA ---------------- */
  if (s.startsWith("255") && s.length === 12) {
    return `+${s}`;
  }
  if (s.startsWith("07") && s.length === 10) {
    return `+255${s.slice(1)}`;
  }

  /* ---------------- RWANDA ---------------- */
  if (s.startsWith("250") && s.length === 12) {
    return `+${s}`;
  }
  if (s.startsWith("07") && s.length === 10) {
    return `+250${s.slice(1)}`;
  }

  /* ---------------- NIGERIA ---------------- */
  if (s.startsWith("234") && s.length === 13) {
    return `+${s}`;
  }
  if (s.startsWith("0") && s.length === 11) {
    return `+234${s.slice(1)}`;
  }

  /* ---------------- GHANA ---------------- */
  if (s.startsWith("233") && s.length === 12) {
    return `+${s}`;
  }
  if (s.startsWith("0") && s.length === 10) {
    return `+233${s.slice(1)}`;
  }

  return null;
};
