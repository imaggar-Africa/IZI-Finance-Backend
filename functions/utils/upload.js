const multer = require("multer");
const bucket = require("../config/firebase");

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

function firebaseSafeUpload(fields) {
  return [
    // 🔹 Handle multer errors properly
    (req, res, next) => {
      upload.fields(fields)(req, res, function (err) {
        if (err instanceof multer.MulterError) {
          return res.status(400).json({
            success: false,
            message: "File upload error",
            error: err.message,
          });
        }

        if (err) {
          return res.status(500).json({
            success: false,
            message: "Unexpected upload error",
            error: err.message,
          });
        }

        next();
      });
    },

    // 🔹 Firebase upload handler
    async (req, res, next) => {
      try {
        if (!req.files) return next();

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
          }
        }

        next();
      } catch (error) {
        console.error("🔥 Firebase Upload Error:", error);

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