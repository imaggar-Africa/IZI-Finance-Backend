// const admin = require("firebase-admin");

// if (!process.env.PROJECT_ID ||
//     !process.env.CLIENT_EMAIL ||
//     !process.env.FB_PRIVATE_KEY ||
//     !process.env.STORAGE_BUCKET) {
//   throw new Error("❌ Firebase env vars missing");
// }

// const serviceAccount = {
//   type: "service_account",
//   project_id: process.env.PROJECT_ID.trim(),
//   client_email: process.env.CLIENT_EMAIL.trim(),
//   private_key: process.env.FB_PRIVATE_KEY.replace(/\\n/g, "\n"),
// };

// if (!admin.apps.length) {
//   admin.initializeApp({
//     credential: admin.credential.cert(serviceAccount),
//     storageBucket: process.env.STORAGE_BUCKET.trim(),
//   });
// }

// module.exports = admin;

const admin = require("firebase-admin");

if (
  !process.env.PROJECT_ID ||
  !process.env.CLIENT_EMAIL ||
  !process.env.FB_PRIVATE_KEY ||
  !process.env.STORAGE_BUCKET
) {
  throw new Error("❌ Firebase env vars missing");
}

const serviceAccount = {
  type: "service_account",
  project_id: process.env.PROJECT_ID.trim(),
  client_email: process.env.CLIENT_EMAIL.trim(),
  private_key: process.env.FB_PRIVATE_KEY.replace(/\\n/g, "\n"),
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.STORAGE_BUCKET.trim(),
  });
}

// ✅ EXPORT STORAGE BUCKET (NOT admin)
const bucket = admin.storage().bucket();
bucket.isConfigured = true;

module.exports = bucket;
