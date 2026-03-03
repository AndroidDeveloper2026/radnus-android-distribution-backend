// const cloudinary = require("../config/cloudinary");
// const streamifier = require("streamifier");

// const uploadToCloudinary = (fileBuffer) => {
//   return new Promise((resolve, reject) => {
//     const stream = cloudinary.uploader.upload_stream(
//       { folder: "products" }, // optional folder
//       (error, result) => {
//         if (result) resolve(result);
//         else reject(error);
//       }
//     );

//     streamifier.createReadStream(fileBuffer).pipe(stream);
//   });
// };

// module.exports = uploadToCloudinary;

const cloudinary = require("../config/cloudinary");
const streamifier = require("streamifier");

const uploadToCloudinary = (buffer, folder = "general") => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder }, // ✅ dynamic folder
      (error, result) => {
        if (result) resolve(result);
        else reject(error);
      }
    );

    streamifier.createReadStream(buffer).pipe(stream);
  });
};

module.exports = uploadToCloudinary;


// const uploadToCloudinary = (buffer, options = {}) => {
//   return new Promise((resolve, reject) => {
//     const stream = cloudinary.uploader.upload_stream(
//       {
//         folder: options.folder || "general",
//         transformation: [{ width: 800, height: 800, crop: "limit" }],
//       },
//       (error, result) => {
//         if (result) resolve(result);
//         else reject(error);
//       }
//     );

//     streamifier.createReadStream(buffer).pipe(stream);
//   });
// };