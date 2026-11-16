const { Receiver } = require("@upstash/qstash");

function header(req, name) {
  const key = Object.keys(req.headers || {}).find(
    (h) => h.toLowerCase() === name.toLowerCase()
  );
  return key ? req.headers[key] : undefined;
}

function resolveJobSlug(req) {
  if (req.query?.job) return String(req.query.job).trim();
  const pathOnly = (req.url || "").split("?")[0];
  const segments = pathOnly.split("/").filter(Boolean);
  const cronIdx = segments.indexOf("cron");
  if (cronIdx >= 0 && segments[cronIdx + 1]) {
    return segments[cronIdx + 1];
  }
  return null;
}

function getRequestBodyString(req) {
  if (req.body === undefined || req.body === null) return "";
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (typeof req.body === "object" && Object.keys(req.body).length === 0) {
    return "";
  }
  return JSON.stringify(req.body);
}

function getPublicBaseUrl() {
  const fromEnv = process.env.CRON_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  }
  return "";
}

function buildPublishedUrl(req) {
  const base = getPublicBaseUrl();
  const job = resolveJobSlug(req);
  if (base && job) return `${base}/api/cron/${job}`;
  if (base && req.url) {
    const pathOnly = req.url.split("?")[0];
    return `${base}${pathOnly}`;
  }
  return undefined;
}

/** Log key fingerprints only — never full secrets. */
function maskSigningKey(key) {
  if (!key) return "(missing)";
  const k = String(key).trim();
  if (k.length <= 10) return `set(len=${k.length})`;
  return `${k.slice(0, 8)}...${k.slice(-4)} (len=${k.length})`;
}

function logQStashKeyContext(extra) {
  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY?.trim();
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY?.trim();
  console.warn("[cron/qstash-auth]", {
    ...extra,
    currentSigningKey: maskSigningKey(currentKey),
    nextSigningKey: maskSigningKey(nextKey),
    cronBaseUrl: getPublicBaseUrl() || "(unset)",
  });
}

/**
 * Accept QStash signed requests or Bearer CRON_SECRET (manual / emergency).
 */
async function authorizeCron(req, res) {
  const auth = header(req, "authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (cronSecret && token && token === cronSecret) {
    return true;
  }

  const signature = header(req, "upstash-signature");
  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY?.trim();
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY?.trim();

  if (!signature) {
    if (!cronSecret && !currentKey && !nextKey) {
      res.status(503).json({
        error:
          "Cron auth not configured. Set QSTASH signing keys and/or CRON_SECRET.",
      });
      return false;
    }
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  if (!currentKey && !nextKey) {
    res.status(503).json({
      error: "QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY not set",
    });
    return false;
  }

  const body = getRequestBodyString(req);
  const upstashRegion = header(req, "upstash-region") || undefined;
  const bodies = [body];
  if (body !== "") bodies.push("");
  if (body !== "{}") bodies.push("{}");
  const publishedUrl = buildPublishedUrl(req);
  const urlAttempts = [{ url: undefined }, ...(publishedUrl ? [{ url: publishedUrl }] : [])];

  const keyPairs = [];
  const pushPair = (c, n, label) => {
    if (c && n) keyPairs.push({ currentSigningKey: c, nextSigningKey: n, label });
  };
  pushPair(currentKey, nextKey, "QSTASH_*");
  if (upstashRegion) {
    const norm = upstashRegion.replace(/-/g, "_").toUpperCase();
    pushPair(
      process.env[`${norm}_QSTASH_CURRENT_SIGNING_KEY`]?.trim(),
      process.env[`${norm}_QSTASH_NEXT_SIGNING_KEY`]?.trim(),
      `${norm}_*`
    );
  }

  let lastErr = null;

  for (const keys of keyPairs) {
    const receiver = new Receiver(keys);
    for (const bodyTry of bodies) {
      for (const { url } of urlAttempts) {
        for (const withRegion of [false, true]) {
          try {
            const payload = {
              signature,
              body: bodyTry,
              clockTolerance: 120,
              ...(withRegion && upstashRegion ? { upstashRegion } : {}),
              ...(url ? { url } : {}),
            };
            await receiver.verify(payload);
            if (keys.label !== "QSTASH_*") {
              console.warn(`[cron/qstash-auth] verified using ${keys.label}`);
            }
            return true;
          } catch (err) {
            lastErr = err;
          }
        }
      }
    }
  }

  logQStashKeyContext({
    event: "verify_failed",
    error: lastErr?.message,
    upstashRegion: upstashRegion || "(no header)",
    bodyLen: body.length,
    verifyUrl: publishedUrl || "(none)",
    signaturePresent: Boolean(signature),
    signatureLen: signature ? String(signature).length : 0,
  });
  res.status(401).json({ error: "Unauthorized" });
  return false;
}

module.exports = {
  authorizeCron,
  resolveJobSlug,
};