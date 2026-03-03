const express = require("express");
const router = express.Router();
const upload = require("../middleware/uploadMemory");
// const upload = require("../middleware/uploadMiddleware");
const controller = require("../controllers/productController");

// router.post("/", upload.single("image"), controller.createProduct);
router.post(
  "/add",
  upload.single("image"), // 🔥 IMPORTANT (same name as frontend)
  controller.createProduct,
);
router.get("/", controller.getProducts);
router.put("/:id", upload.single("image"), controller.updateProduct);
router.delete("/:id", controller.deleteProduct);

// bulk upload
router.post(
  "/bulk-upload",
  upload.single("file"),
  controller.bulkUploadProducts,
);

module.exports = router;
