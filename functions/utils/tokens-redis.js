const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const redisModule = require("./redis");
const { defineSecret } = require("firebase-functions/params");

// --- Firebase Secrets (fallback to process.env on Vercel / local) ---
const JWT_ACCESS_SECRET = defineSecret("JWT_ACCESS_SECRET");
const JWT_REFRESH_SECRET = defineSecret("JWT_REFRESH_SECRET");
const JWT_ACCESS_TTL = defineSecret("JWT_ACCESS_TTL");
const JWT_REFRESH_TTL = defineSecret("JWT_REFRESH_TTL");

function secretOrEnv(secretParam, envName, label) {
  const fromParam = secretParam.value()?.trim();
  if (fromParam) return fromParam;
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv) return fromEnv;
  const err = new Error(`${label} is not configured (${envName})`);
  err.code = "MISSING_SECRET";
  throw err;
}

function optionalTtl(secretParam, envName, fallback) {
  return (
    secretParam.value()?.trim() ||
    process.env[envName]?.trim() ||
    fallback
  );
}

// --- Ensure Redis is configured ---
function assertRedisConfigured() {
  if (!redisModule.isRedisEnabled || !redisModule.redis) {
    const err = new Error("Redis is not configured");
    err.code = "REDIS_DISABLED";
    throw err;
  }
}

// --- Sign short-lived Access Token ---
function signAccess(payload) {
  return jwt.sign(payload, secretOrEnv(JWT_ACCESS_SECRET, "JWT_ACCESS_SECRET", "JWT access secret"), {
    expiresIn: optionalTtl(JWT_ACCESS_TTL, "JWT_ACCESS_TTL", "30d"),
  });
}

// --- Sign Refresh Token (contains jti + type) ---
function signRefresh({ sub, jti }) {
  return jwt.sign(
    { sub, jti, type: "refresh" },
    secretOrEnv(JWT_REFRESH_SECRET, "JWT_REFRESH_SECRET", "JWT refresh secret"),
    {
      expiresIn: optionalTtl(JWT_REFRESH_TTL, "JWT_REFRESH_TTL", "50d"),
    }
  );
}

// --- Create a session (store in Redis) and return refresh token ---
async function issueSession(userId, ctx = {}) {
  const jti = crypto.randomUUID
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");

  const refreshToken = signRefresh({ sub: userId, jti });

  // Compute TTL from JWT exp so Redis expires the key correctly
  const decoded = jwt.decode(refreshToken);
  const ttlSec = Math.max(1, decoded.exp - Math.floor(Date.now() / 1000));

  const key = `rt:${jti}`;
  assertRedisConfigured();

  // ✅ FIXED: Upstash Redis uses lowercase hset()
  await redisModule.redis.hset(key, {
    userId: String(userId),
    ua: String(ctx.ua || ""),
    ip: String(ctx.ip || ""),
    createdAt: String(Date.now()),
  });

  // ✅ expire() works fine with Upstash
  await redisModule.redis.expire(key, ttlSec);

  return { refreshToken, jti };
}

// --- Rotate a refresh token (single-use) ---
async function rotateRefresh(oldRefreshToken, ctx = {}) {
  let decoded;
  try {
    decoded = jwt.verify(
      oldRefreshToken,
      secretOrEnv(JWT_REFRESH_SECRET, "JWT_REFRESH_SECRET", "JWT refresh secret")
    );
  } catch (e) {
    const err = new Error("invalid");
    err.code = "JWT_VERIFY";
    throw err;
  }

  if (decoded.type !== "refresh" || !decoded.jti || !decoded.sub) {
    const err = new Error("invalid");
    err.code = "BAD_PAYLOAD";
    throw err;
  }

  const key = `rt:${decoded.jti}`;
  assertRedisConfigured();

  const exists = await redisModule.redis.exists(key);
  if (!exists) {
    const err = new Error("invalid");
    err.code = "NOT_FOUND";
    throw err;
  }

  // Revoke old token (single-use)
  await redisModule.redis.del(key);

  // Mint new refresh token
  const { refreshToken, jti } = await issueSession(decoded.sub, ctx);
  return { userId: decoded.sub, refreshToken };
}

// --- Optional: Revoke a given refresh token (logout) ---
async function revokeRefresh(refreshToken) {
  try {
    const { jti } = jwt.verify(
      refreshToken,
      secretOrEnv(JWT_REFRESH_SECRET, "JWT_REFRESH_SECRET", "JWT refresh secret")
    );
    if (!jti) return false;
    assertRedisConfigured();
    await redisModule.redis.del(`rt:${jti}`);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  signAccess,
  issueSession,
  rotateRefresh,
  revokeRefresh,
};
