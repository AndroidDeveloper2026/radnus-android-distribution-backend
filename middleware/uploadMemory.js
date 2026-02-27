// uploadMemory.js ✅ (NEW)
const multer = require("multer");

const storage = multer.memoryStorage();
console.log('--- upload memeory ---',storage)
const uploadMemory = multer({
  storage: storage,
});

console.log('--- upload memeory ---',uploadMemory)

module.exports = uploadMemory;