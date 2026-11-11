/** Extra fields for 500 JSON while debugging (Vercel / non-production). */
function serverErrorBody(err) {
  const payload = {
    details: err?.message || String(err),
  };
  if (err?.code) payload.code = err.code;
  if (
    process.env.IZI_RUNTIME === "vercel" ||
    process.env.NODE_ENV !== "production"
  ) {
    payload.stack = err?.stack || null;
  }
  return payload;
}

module.exports = { serverErrorBody };
