const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadMemory");
const Retailer = require("../models/RetailerModel/Retailer");

const {
  createRetailer,
  getRetailers,
  updateStatus,
  updateRetailer,
  deleteRetailer
} = require("../controllers/retailerController");

router.post('/', upload.single('shopPhoto'), async (req, res) => {
  try {
    const retailer = new Retailer({
      ...req.body,
      shopPhoto: req.file.path,
    });

    await retailer.save();
    res.json(retailer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// router.post("/", upload.single("shopPhoto"), createRetailer);
router.get("/", getRetailers);
router.patch("/:id/status", updateStatus);
router.put("/:id", updateRetailer);     // EDIT
router.delete("/:id", deleteRetailer); // DELETE

module.exports = router;