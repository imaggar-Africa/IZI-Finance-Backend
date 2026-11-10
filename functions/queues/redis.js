const { Redis } = require("ioredis");

/**
 * Lazy initializer for BullMQ Redis connection.
 */
let _bullRedis = null;

const getBullRedis = () => {
    if (_bullRedis) return _bullRedis;

    // 1. Try specific Redis TCP configuration
    let host = (global.config?.redisHost || process.env.REDIS_HOST)?.trim();
    let portStr = (global.config?.redisPort || process.env.REDIS_PORT)?.trim();
    let port = portStr ? Number(portStr) : 6379;
    let password = (global.config?.redisPassword || process.env.REDIS_PASSWORD)?.trim();
    let tlsConfig = (global.config?.redisTls || process.env.REDIS_TLS)?.trim();
    let tls = tlsConfig === "true" || tlsConfig === true ? {} : undefined;

    // 2. Fall back to UPSTASH_REDIS_REST_URL parsing if REDIS_HOST is not set
    if (!host) {
        let upstashUrl = (global.config?.redisUrl || process.env.UPSTASH_REDIS_REST_URL)?.trim();
        let upstashToken = (global.config?.redisToken || process.env.UPSTASH_REDIS_REST_TOKEN)?.trim();

        // Strip surrounding quotes
        const stripQuotes = (str) => {
            if (!str) return str;
            let s = str.trim();
            if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
            if (s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1).trim();
            return s;
        };

        upstashUrl = stripQuotes(upstashUrl);
        upstashToken = stripQuotes(upstashToken);

        if (upstashUrl) {
            try {
                let urlStr = upstashUrl;
                if (!urlStr.includes("://")) {
                    urlStr = "https://" + urlStr;
                }
                const parsedUrl = new URL(urlStr);
                host = parsedUrl.hostname;
                port = parsedUrl.port ? Number(parsedUrl.port) : 6379;
                password = upstashToken || undefined;
                tls = {}; // Upstash Redis always requires TLS for external connections
                console.log(`ℹ️ Using parsed Upstash REST URL for BullMQ: ${host}`);
            } catch (err) {
                console.error("❌ Failed to parse UPSTASH_REDIS_REST_URL for BullMQ:", err.message);
            }
        }
    }

    if (!host) {
        console.warn("⚠️ No Redis configuration found for BullMQ. Connection aborted.");
        return null;
    }

    _bullRedis = new Redis({
        host,
        port,
        password: password || undefined,
        maxRetriesPerRequest: null,
        tls,
        keepAlive: 10000, // Send a TCP keepalive packet every 10s
        retryStrategy(times) {
            // Reconnect with exponential backoff (capped at 3s)
            return Math.min(times * 100, 3000);
        },
        // 🔥 CRITICAL: Prevent ioredis from connecting immediately during analysis phase
        lazyConnect: true, 
    });

    _bullRedis.on("connect", () => {
        console.log(`✅ BullMQ Redis connected to ${host}:${port}`);
    });

    _bullRedis.on("error", (err) => {
        console.error("❌ BullMQ Redis error:", err.message);
    });

    return _bullRedis;
};

// Export a Proxy that evaluates the client lazily
const proxy = new Proxy({}, {
    get: (target, prop) => {
        const client = getBullRedis();
        if (!client) {
            console.warn(`⚠️ BullMQ Redis client is not initialized. Property '${prop}' accessed.`);
            return undefined;
        }
        const val = client[prop];
        return typeof val === 'function' ? val.bind(client) : val;
    }
});

module.exports = proxy;