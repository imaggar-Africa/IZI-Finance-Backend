const path = require("path");
const { randomUUID } = require("crypto");
const id = randomUUID();
const bucket = require("../config/firebase");

/**
 * Upload a file to Firebase Storage
 * @param {Object} file - multer file object
 * @param {String} baseName - clean base name
 * @param {String} folder - folder inside bucket
 * @returns {Promise<String|null>}
 */
const uploadToFirebase = async (file, baseName, folder = "borrowers") => {
  return new Promise(async (resolve, reject) => {
    try {
      // ✅ No file → no upload
      if (!file) return resolve(null);

      // ✅ Firebase not configured → skip safely
      if (!bucket || !bucket.isConfigured) {
        console.warn("⚠️ Firebase Storage NOT configured. Skipping upload.");
        return resolve(null);
      }

      // ✅ Build truly unique filename
      const ext = path.extname(file.originalname) || ".jpg";
      const safeBase = baseName.replace(/[^a-zA-Z0-9_-]/g, "");
      const uniqueId = uuidv4(); // 🔥 CRITICAL FIX

      const fileName = `${folder}/${safeBase}_${uniqueId}${ext}`;
      const fileRef = bucket.file(fileName);

      const stream = fileRef.createWriteStream({
        metadata: {
          contentType: file.mimetype,
          cacheControl: "no-store, no-cache, must-revalidate, max-age=0", // 🔥 STOP CACHING
        },
        resumable: false,
      });

      stream.on("error", (err) => {
        console.error("🔥 Firebase upload error:", err);
        reject(err);
      });

      stream.on("finish", async () => {
        try {
          await fileRef.makePublic();

          const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
          resolve(publicUrl);
        } catch (err) {
          console.error("🔥 Error making file public:", err);
          reject(err);
        }
      });

      stream.end(file.buffer);
    } catch (err) {
      reject(err);
    }
  });
};

module.exports = uploadToFirebase;
