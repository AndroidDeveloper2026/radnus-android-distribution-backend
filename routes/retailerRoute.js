const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadMemory");

const {
  createRetailer,
  getRetailers,
  updateStatus,
} = require("../controllers/retailerController");

router.post("/", upload.single("shopPhoto"), createRetailer);
router.get("/", getRetailers);
router.patch("/:id/status", updateStatus);
router.put("/:id", updateRetailer);     // EDIT
router.delete("/:id", deleteRetailer); // DELETE

module.exports = router;