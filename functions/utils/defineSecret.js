/** Firebase defineSecret on Firebase; process.env-backed on Vercel / when package missing. */
function envBackedSecret(name) {
  return {
    value() {
      const fromEnv = process.env[name];
      return fromEnv == null ? "" : String(fromEnv).trim();
    },
  };
}

function defineSecret(name) {
  if (process.env.IZI_RUNTIME === "vercel") {
    return envBackedSecret(name);
  }
  try {
    const { defineSecret: ffDefineSecret } = require("firebase-functions/params");
    return ffDefineSecret(name);
  } catch {
    return envBackedSecret(name);
  }
}

module.exports = { defineSecret };
