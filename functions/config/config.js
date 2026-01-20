const admin = require("firebase-admin");
const { Writable } = require("stream");

/**
 * Required environment variables
 * (must ALL exist or Firebase runs in noop mode)
 */
const requiredEnv = [
  "PROJECT_ID",
  "CLIENT_EMAIL",
  "FB_PRIVATE_KEY",
  "FB_STORAGE_BUCKET",
];

const missing = requiredEnv.filter(
  (key) => !process.env[key] || !process.env[key].trim()
);

let bucket;
const configured = missing.length === 0;

if (!configured) {
  console.warn(
    `⚠️ Firebase Storage NOT configured. Missing: ${missing.join(", ")}`
  );

  // Safe no-op writable stream (unchanged behavior)
  const noopStream = () => {
    const sink = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    process.nextTick(() => sink.emit("finish"));
    return sink;
  };

  bucket = {
    name: "unconfigured-storage",
    isConfigured: false,
    file: () => ({
      createWriteStream: noopStream,
      makePublic: async () => {},
    }),
  };

} else {
  // 🔐 Build service account safely (Windows + dotenv safe)
  const serviceAccount = {
    type: "service_account",
    project_id: process.env.PROJECT_ID.trim(),
    client_email: process.env.CLIENT_EMAIL.trim(),
    private_key: process.env.FB_PRIVATE_KEY
      .replace(/^"|"$/g, "") // remove wrapping quotes if present
      .replace(/\\n/g, "\n") // convert literal \n to real newlines
      .trim(),
  };

  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: process.env.FB_STORAGE_BUCKET.trim(),
      });
    }

    bucket = admin.storage().bucket();
    bucket.isConfigured = true;

    console.log("✅ Firebase bucket initialized:", bucket.name);
  } catch (err) {
    console.error("❌ Failed to initialize Firebase:", err.message);

    // Fallback to noop bucket to avoid app crash
    const noopStream = () => {
      const sink = new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
      process.nextTick(() => sink.emit("finish"));
      return sink;
    };

    bucket = {
      name: "unconfigured-storage",
      isConfigured: false,
      file: () => ({
        createWriteStream: noopStream,
        makePublic: async () => {},
      }),
    };
  }
}

module.exports = bucket;
