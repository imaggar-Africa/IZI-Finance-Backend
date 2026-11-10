// redis.js
const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '../../.env')
});
const { Redis } = require('@upstash/redis');
const { createClient } = require('redis');

let _redisClient = null;
let _isRedisEnabled = false;
let _initialized = false;

function initRedisClient() {
  if (_initialized) return;

  const config = global.config || {};
  let upstashUrl = (config.redisUrl || process.env.UPSTASH_REDIS_REST_URL)?.trim();
  let upstashToken = (config.redisToken || process.env.UPSTASH_REDIS_REST_TOKEN)?.trim();
  const redisUrl = (config.redisUrlLocal || process.env.REDIS_URL)?.trim();

  // Helper to strip surrounding quotes
  const stripQuotes = (str) => {
    if (!str) return str;
    let s = str.trim();
    if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
    if (s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1).trim();
    return s;
  };

  upstashUrl = stripQuotes(upstashUrl);
  upstashToken = stripQuotes(upstashToken);

  // Ensure Upstash Url starts with protocol
  if (upstashUrl && !upstashUrl.includes("://")) {
    upstashUrl = "https://" + upstashUrl;
  }

  try {
    if (upstashUrl && upstashToken) {
      // ✅ Use Upstash REST API (best for serverless)
      _redisClient = new Redis({
        url: upstashUrl,
        token: upstashToken,
      });
      _isRedisEnabled = true;
      console.log(`✅ Connected to Upstash Redis (REST) | URL: ${upstashUrl} | Token: ${upstashToken}`);
    } else if (redisUrl) {
      // 🔄 Use local Redis if available
      _redisClient = createClient({ url: redisUrl });
      _redisClient.on('error', (err) => console.error('Redis error:', err));
      _isRedisEnabled = true;
      console.log('✅ Connected to local Redis');
    } else {
      console.warn('⚠️ No Redis configuration found');
    }
  } catch (err) {
    console.warn('⚠️ Redis initialization failed:', err.message);
  }

  _initialized = true;
}

// Only call connect for local Redis (Upstash REST doesn't need it)
async function ensureRedis(config = {}) {
  if (config && Object.keys(config).length > 0) {
    global.config = { ...(global.config || {}), ...config };
  }

  initRedisClient();

  if (_redisClient && _redisClient.connect && !_redisClient.isOpen) {
    try {
      await _redisClient.connect();
      console.log('Redis connected');
    } catch (err) {
      console.warn('⚠️ Redis connection failed:', err.message);
    }
  }
}

module.exports = {
  get redis() {
    initRedisClient();
    return _redisClient;
  },
  get isRedisEnabled() {
    initRedisClient();
    return _isRedisEnabled;
  },
  ensureRedis
};
