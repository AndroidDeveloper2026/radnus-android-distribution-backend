// // uploadMemory.js ✅ (NEW)
// const multer = require("multer");

// const storage = multer.memoryStorage();
// console.log('--- upload memeory ---',storage)
// const uploadMemory = multer({
//   storage: storage,
// });

// console.log('--- upload memeory ---',uploadMemory)

// module.exports = uploadMemory;

const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/"); // folder
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

module.exports = upload;