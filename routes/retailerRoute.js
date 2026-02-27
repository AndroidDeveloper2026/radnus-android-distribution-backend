const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadMemory");
const Retailer = require("../models/RetailerModel/Retailer");

const {
  createRetailer,
  getRetailers,
  updateStatus,
  updateRetailer,
  deleteRetailer,
} = require("../controllers/retailerController");

// router.post('/retailer', upload.single('shopPhoto'), async (req, res) => {
//     console.log("BODY:", req.body);
//   console.log("FILE:", req.file);
//   try {
//     const retailer = new Retailer({
//       ...req.body,
//       shopPhoto: req.file ? req.file.path : null,
//     });

//     await retailer.save();
//     res.json(retailer);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
router.post("/retailers", upload.single("shopPhoto"), createRetailer);
// router.post("/", upload.single("shopPhoto"), createRetailer);
router.get("/", getRetailers);
router.patch("/:id/status", updateStatus);
router.put("/:id", updateRetailer); // EDIT
router.delete("/:id", deleteRetailer); // DELETE

module.exports = router;
