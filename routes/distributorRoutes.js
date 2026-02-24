const express = require("express");
const router = express.Router();

const {
  createDistributor,
  getDistributors,
  updateDistributor,
  deleteDistributor,
  updateStatus,
} = require("../controllers/distributorController");

const authMiddleware = require("../middleware/authMiddleware");

/* ROUTES */

// Create
router.post("/", authMiddleware, createDistributor);

// Get all (with optional ?status=PENDING)
router.get("/", authMiddleware, getDistributors);

// Update
router.put("/:id", authMiddleware, updateDistributor);

// Delete
router.delete("/:id", authMiddleware, deleteDistributor);

// Approve / Reject
router.patch("/:id/status", authMiddleware, updateStatus);

module.exports = router;