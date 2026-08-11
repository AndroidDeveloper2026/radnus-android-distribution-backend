// routes/purchaseRoutes.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");

const {
  createPurchaseEntry,
  getPurchaseEntries,
  getPurchaseEntryById,
  updatePurchaseEntry,
  getStockAging,
  getNonMovingStock,
  getPriceHistory,
  getProductPriceHistory,
  getProductBatches, // Add this
  getProductBatchAvailability,
  getBatchAvailabilityBulk
} = require("../controllers/purchaseController");

router.post("/", auth, createPurchaseEntry);
router.get("/", auth, getPurchaseEntries);

// Report routes - must be declared before "/:id" route
router.get("/stock-aging", auth, getStockAging);
router.get("/non-moving-stock", auth, getNonMovingStock);
router.get("/price-history/:productId", auth, getPriceHistory);
router.get("/product-price-history/:productId", auth, getProductPriceHistory);

// Product batches for OrderCartPage
router.post("/product-batches", auth, getProductBatches);

// ✅ NEW: bulk batch-availability for many products in a single request
// (replaces having to call the single-product availability route once
// per product, which was causing the order cart page to load very slowly).
router.post("/product-batches/availability-bulk", auth, getBatchAvailabilityBulk);

// Single purchase routes
router.get("/:id", auth, getPurchaseEntryById);
router.put("/:id", auth, updatePurchaseEntry);

// routes/purchaseRoutes.js - Add this new route

// Get available batch quantities for a product (for order cart)
router.get('/product-batches/:productId/availability', auth, getProductBatchAvailability);

module.exports = router;

//------ 11.08.2026 ------------------------
// // routes/purchaseRoutes.js
// const express = require("express");
// const router = express.Router();
// const auth = require("../middleware/authMiddleware");

// const {
//   createPurchaseEntry,
//   getPurchaseEntries,
//   getPurchaseEntryById,
//   updatePurchaseEntry,
//   getStockAging,
//   getNonMovingStock,
//   getPriceHistory,
//   getProductPriceHistory,
//   getProductBatches, // Add this
//   getProductBatchAvailability
// } = require("../controllers/purchaseController");

// router.post("/", auth, createPurchaseEntry);
// router.get("/", auth, getPurchaseEntries);

// // Report routes - must be declared before "/:id" route
// router.get("/stock-aging", auth, getStockAging);
// router.get("/non-moving-stock", auth, getNonMovingStock);
// router.get("/price-history/:productId", auth, getPriceHistory);
// router.get("/product-price-history/:productId", auth, getProductPriceHistory);

// // Product batches for OrderCartPage
// router.post("/product-batches", auth, getProductBatches);

// // Single purchase routes
// router.get("/:id", auth, getPurchaseEntryById);
// router.put("/:id", auth, updatePurchaseEntry);

// // routes/purchaseRoutes.js - Add this new route

// // Get available batch quantities for a product (for order cart)
// router.get('/product-batches/:productId/availability', auth, getProductBatchAvailability);

// module.exports = router;

// //========== 04.08.26 ==============
// // // routes/purchaseRoutes.js
// // const express = require("express");
// // const router = express.Router();
// // const auth = require("../middleware/authMiddleware");

// // const {
// //   createPurchaseEntry,
// //   getPurchaseEntries,
// //   getPurchaseEntryById,
// //   updatePurchaseEntry,
// //   getStockAging,
// //   getNonMovingStock,
// //   getPriceHistory,
// //   getProductPriceHistory,
// // } = require("../controllers/purchaseController");

// // router.post("/", auth, createPurchaseEntry);
// // router.get("/", auth, getPurchaseEntries);

// // // Report routes - must be declared before "/:id" route
// // router.get("/stock-aging", auth, getStockAging);
// // router.get("/non-moving-stock", auth, getNonMovingStock);
// // router.get("/price-history/:productId", auth, getPriceHistory);
// // router.get("/product-price-history/:productId", auth, getProductPriceHistory);

// // // Single purchase routes
// // router.get("/:id", auth, getPurchaseEntryById);
// // router.put("/:id", auth, updatePurchaseEntry);

// // module.exports = router;

