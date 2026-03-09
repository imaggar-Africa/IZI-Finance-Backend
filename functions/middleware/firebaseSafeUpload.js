const multer = require("multer");

console.log("🔥 firebaseSafeUpload FILE LOADED");

const storage = multer.memoryStorage();

const upload = multer({ storage });

module.exports = (fields) => {
  console.log("🔥 firebaseSafeUpload MIDDLEWARE CALLED");
  return upload.fields(fields);
};
