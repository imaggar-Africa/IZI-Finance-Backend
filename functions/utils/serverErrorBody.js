/** Extra fields for 500 JSON while debugging (Vercel / non-production). */
function unwrapErrorMessage(err) {
  const parts = [err?.message || String(err)];
  let c = err?.cause;
  while (c) {
    const bit = [c.code, c.message].filter(Boolean).join(": ");
    if (bit) parts.push(bit);
    c = c.cause;
  }
  return parts.filter(Boolean).join(" | ");
}

function serverErrorBody(err) {
  const payload = {
    details: unwrapErrorMessage(err),
  };
  if (err?.code) payload.code = err.code;
  if (err?.cause?.code) payload.cause = err.cause.code;
  if (
    process.env.IZI_RUNTIME === "vercel" ||
    process.env.NODE_ENV !== "production"
  ) {
    payload.stack = err?.stack || null;
  }
  return payload;
}

module.exports = { serverErrorBody };
