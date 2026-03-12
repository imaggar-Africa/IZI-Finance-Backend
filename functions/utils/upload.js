// const multer = require("multer");
// const stream = require("stream");

// const storage = multer.memoryStorage();

// const upload = multer({
//   storage,
//   limits: {
//     fileSize: 5 * 1024 * 1024,
//   },
// });

// function firebaseSafeUpload(fields) {
//   return (req, res, next) => {
//     if (req.rawBody) {
//       const bufferStream = new stream.PassThrough();
//       bufferStream.end(req.rawBody);
//       req.pipe = bufferStream.pipe.bind(bufferStream); 
//     }

//     upload.fields(fields)(req, res, next);
//   };
// }

// module.exports = firebaseSafeUpload;

const multer = require("multer");
const bucket = require("../config/firebase");

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

function firebaseSafeUpload(fields) {
  return [
    upload.fields(fields),

    async (req, res, next) => {
      try {
        if (!req.files) return next();

        for (const fieldName in req.files) {
          for (const file of req.files[fieldName]) {

            // ✅ Unique filename
            const fileName = `borrowers/${fieldName}_${Date.now()}_${file.originalname}`;

            const fileUpload = bucket.file(fileName);

            // ✅ Upload buffer to Firebase
            await fileUpload.save(file.buffer, {
              metadata: {
                contentType: file.mimetype,
              },
            });

            // ✅ Make public
            await fileUpload.makePublic();

            // ✅ Attach URL to file object
            file.url = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
          }
        }

        next();
      } catch (error) {
        console.error("🔥 Firebase Upload Error:", error);
        return res.status(500).json({
          message: "Firebase upload failed",
          error: error.message,
        });
      }
    },
  ];
}

module.exports = firebaseSafeUpload;