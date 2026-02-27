const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadMemory");

const {
  createRetailer,
  getRetailers,
  updateStatus,
  updateRetailer,
  deleteRetailer,
} = require("../controllers/retailerController");

// ✅ CLEAN
router.post("/", upload.single("shopPhoto"), createRetailer);

router.get("/", getRetailers);
router.patch("/:id/status", updateStatus);
router.put("/:id", updateRetailer);
router.delete("/:id", deleteRetailer);

module.exports = router;