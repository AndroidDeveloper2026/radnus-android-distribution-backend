const express = require("express");
const router = express.Router();

const {
  createActivityLog,
  getActivityLogs
} = require("../controllers/activityLogController");

const authenticate = require("../middleware/authMiddleware");

// POST
router.post("/", authenticate, createActivityLog);

// GET (Admin only)
router.get("/", authenticate, getActivityLogs);

module.exports = router;