const express = require("express");
const router = express.Router();
const uploadMemory = require("../middleware/uploadMemory");

const {
  createDistributor,
  getDistributors,
  updateDistributor,
  deleteDistributor,
  updateStatus,
} = require("../controllers/distributorController");

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