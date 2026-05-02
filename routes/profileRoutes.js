const express = require("express");
const router = express.Router();
const multer = require("multer");
const auth = require("../middleware/authMiddleware"); // your auth middleware
const { getProfile, updateProfile } = require("../controllers/profileController");

// Multer: store image in memory so we can upload buffer to Cloudinary
const upload = multer({ storage: multer.memoryStorage() });

// GET current user profile
router.get("/me", auth, getProfile);

// PUT update profile (multipart/form-data with optional "photo" file)
router.put("/me", auth, upload.single("photo"), updateProfile);

module.exports = router;