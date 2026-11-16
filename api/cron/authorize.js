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

  const receiver = new Receiver({
    currentSigningKey: currentKey,
    nextSigningKey: nextKey,
  });

  const body = getRequestBodyString(req);
  const upstashRegion = header(req, "upstash-region") || undefined;
  const verifyBase = { signature, body, upstashRegion };

  try {
    // Match @upstash/qstash Next/Express helpers (no url) — works for EU schedules.
    await receiver.verify(verifyBase);
    return true;
  } catch (err) {
    const publishedUrl = buildPublishedUrl(req);
    if (publishedUrl) {
      try {
        await receiver.verify({ ...verifyBase, url: publishedUrl });
        return true;
      } catch (errUrl) {
        console.warn("QStash verify failed:", err.message, "| url:", errUrl.message);
      }
    } else {
      console.warn("QStash verify failed:", err.message);
    }
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
}

module.exports = {
  authorizeCron,
  resolveJobSlug,
};