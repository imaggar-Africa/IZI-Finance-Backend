const admin = require("firebase-admin");

let bucketInstance = null;

function getStorageBucketName() {
  return (
    process.env.STORAGE_BUCKET ||
    process.env.FB_STORAGE_BUCKET ||
    ""
  ).trim();
}

function getFirebaseBucket() {
  if (bucketInstance) return bucketInstance;

  const projectId = process.env.PROJECT_ID?.trim();
  const clientEmail = process.env.CLIENT_EMAIL?.trim();
  const privateKeyRaw = process.env.FB_PRIVATE_KEY;
  const storageBucket = getStorageBucketName();

  if (!projectId || !clientEmail || !privateKeyRaw || !storageBucket) {
    throw new Error(
      "Firebase env vars missing (PROJECT_ID, CLIENT_EMAIL, FB_PRIVATE_KEY, STORAGE_BUCKET or FB_STORAGE_BUCKET)"
    );
  }

  const serviceAccount = {
    type: "service_account",
    project_id: projectId,
    client_email: clientEmail,
    private_key: String(privateKeyRaw)
      .replace(/\\n/g, "\n")
      .replace(/^["']|["']$/g, "")
      .trim(),
  };

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket,
    });
  }

  bucketInstance = admin.storage().bucket();
  bucketInstance.isConfigured = true;
  return bucketInstance;
}

module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      const bucket = getFirebaseBucket();
      const value = bucket[prop];
      return typeof value === "function" ? value.bind(bucket) : value;
    },
  }
);

module.exports.getFirebaseBucket = getFirebaseBucket;
