// const express = require("express");
// const router = express.Router();

// const {
//   createDistributor,
//   getDistributors,
//   updateDistributor,
//   deleteDistributor,
//   updateStatus,
// } = require("../controllers/distributorController");

// const authMiddleware = require("../middleware/authMiddleware");

// /* ROUTES */

// // Create
// router.post("/", authMiddleware, createDistributor);

// // Get all (with optional ?status=PENDING)
// router.get("/", authMiddleware, getDistributors);

// // Update
// router.put("/:id", authMiddleware, updateDistributor);

// // Delete
// router.delete("/:id", authMiddleware, deleteDistributor);

// // Approve / Reject
// router.patch("/:id/status", authMiddleware, updateStatus);

// module.exports = router;

//-----------------

const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadMemory");

const {
  createDistributor,
  getDistributors,
  updateDistributor,
  deleteDistributor,
  updateStatus,
} = require("../controllers/distributorController");

// ✅ MULTIPLE IMAGE FIELDS
// router.post(
//   "/",
//   upload.fields([
//     { name: "profile", maxCount: 1 },
//     { name: "shop", maxCount: 1 },
//     { name: "aadhaar", maxCount: 1 },
//     { name: "passport", maxCount: 1 },
//   ]),
//   createDistributor
// );

router.post(
  "/",
  uploadMemory.single("profile"), // ✅ only profile
  createDistributor
);

router.get("/", getDistributors);
router.put("/:id", updateDistributor);
router.delete("/:id", deleteDistributor);
router.patch("/:id/status", updateStatus);

module.exports = router;