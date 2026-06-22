const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const {
  getPendingRegistrations,
  approveRegistration,
  rejectRegistration,
  getRegistrationStats,
  getRegistrationDetails,
  bulkApproveRegistrations,
} = require("../controllers/adminApprovalController");

// ✅ All routes require authentication and Admin role
router.use(auth);

// 📋 Get all pending registrations
router.get("/pending", getPendingRegistrations);

// 📊 Get registration statistics
router.get("/stats", getRegistrationStats);

// 🔍 Get single registration details
router.get("/:userId", getRegistrationDetails);

// ✅ Approve a registration
router.put("/:userId/approve", approveRegistration);

// ❌ Reject a registration
router.put("/:userId/reject", rejectRegistration);

// 📝 Bulk approve registrations
router.post("/bulk-approve", bulkApproveRegistrations);

module.exports = router;