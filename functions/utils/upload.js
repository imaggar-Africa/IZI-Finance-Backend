const multer = require("multer");
const bucket = require("../config/firebase");
const Busboy = require("@fastify/busboy");

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

/**
 * 🚀 Firebase Safe Upload
 * Handles multipart form-data even when Firebase has already consumed the stream (rawBody)
 */
function firebaseSafeUpload(fields) {
  return [
    (req, res, next) => {
      // 🔍 DEBUG: Log incoming request state
      console.log("📂 Incoming Upload Request:", {
        contentType: req.headers["content-type"],
        contentLength: req.headers["content-length"],
        hasRawBody: !!req.rawBody,
        method: req.method
      });

      if (!req.is("multipart/form-data")) {
        return res.status(400).json({
          success: false,
          message: "Request must be multipart/form-data",
        });
      }

      // 🛠️ CASE 1: Firebase has already buffered the body (Common in Gen 2)
      if (req.rawBody) {
        console.log("🔄 Parsing from req.rawBody...");
        try {
          const busboy = Busboy({ headers: req.headers });

          req.files = {};
          req.body = req.body || {}; // Preserve any existing body data

          busboy.on("file", (fieldname, file, info) => {
            const { filename, encoding, mimeType: mimetype } = info;
            const chunks = [];
            file.on("data", (chunk) => chunks.push(chunk));
            file.on("end", () => {
              if (!req.files[fieldname]) req.files[fieldname] = [];
              req.files[fieldname].push({
                fieldname,
                originalname: filename,
                encoding,
                mimetype,
                buffer: Buffer.concat(chunks),
                size: Buffer.concat(chunks).length,
              });
            });
          });

          busboy.on("field", (fieldname, val) => {
            req.body[fieldname] = val;
          });

          busboy.on("finish", () => {
            console.log("✅ Busboy finished parsing rawBody");
            next();
          });

          busboy.on("error", (err) => {
            console.error("❌ Busboy Error:", err);
            res.status(400).json({ success: false, message: "Parse error", error: err.message });
          });

          busboy.end(req.rawBody);
          return;
        } catch (e) {
          console.error("❌ Busboy Init Error:", e);
          return res.status(500).json({ success: false, message: "Upload initialization failed" });
        }
      }

      // 🛠️ CASE 2: Standard stream parsing (Fallback for Local / Other envs)
      console.log("🌊 Parsing from Request Stream...");
      upload.fields(fields)(req, res, function (err) {
        if (err instanceof multer.MulterError) {
          console.error("❌ Multer Error:", err);
          return res.status(400).json({
            success: false,
            message: "File upload error",
            error: err.message,
            code: err.code,
          });
        }

        if (err) {
          console.error("❌ Unexpected Upload Stream Error:", err);
          return res.status(500).json({
            success: false,
            message: "Unexpected upload error (Stream interrupted)",
            error: err.message,
          });
        }

        next();
      });
    },

    // 🔹 Firebase Storage upload handler
    async (req, res, next) => {
      try {
        if (!req.files || Object.keys(req.files).length === 0) return next();

        console.log("⏳ Uploading files to Firebase Storage...");
        for (const fieldName in req.files) {
          for (const file of req.files[fieldName]) {
            const fileName = `borrowers/${fieldName}_${Date.now()}_${file.originalname}`;
            const fileUpload = bucket.file(fileName);

            await fileUpload.save(file.buffer, {
              metadata: {
                contentType: file.mimetype,
              },
            });

            await fileUpload.makePublic();
            file.url = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
            console.log(`✅ Uploaded: ${fieldName} -> ${file.url}`);
          }
        }

        next();
      } catch (error) {
        console.error("🔥 Firebase Storage Upload Error:", error);

        return res.status(500).json({
          success: false,
          message: "Firebase upload failed",
          error: error.message,
        });
      }
    },
  ];
}

module.exports = firebaseSafeUpload;