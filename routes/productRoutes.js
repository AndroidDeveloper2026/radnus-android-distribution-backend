const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadMemory");
const controller = require("../controllers/productController");


router.post(
  "/add",
  upload.single("image"), // 🔥 IMPORTANT (same name as frontend)
  controller.createProduct,
);
router.get("/", controller.getProducts);
router.put("/:id", upload.single("image"), controller.updateProduct);
router.delete("/:id", controller.deleteProduct);
router.post("/reduce-stock", controller.reduceStock);
// bulk upload
router.post(
  "/bulk-upload",
  upload.single("file"),
  controller.bulkUploadProducts,
);

// routes/productRoutes.js - Add this new route

// Update product stock
router.patch('/:id/stock', controller.updateProductStock);

module.exports = router;
