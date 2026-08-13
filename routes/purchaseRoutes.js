
// routes/purchaseRoutes.js

const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");

const {
  // ─── Purchase CRUD ──────────────────────────────────────────────
  createPurchaseEntry,
  getPurchaseEntries,
  getPurchaseEntryById,
  updatePurchaseEntry,
  
  // ─── Reports ─────────────────────────────────────────────────────
  getStockAging,
  getNonMovingStock,
  getPriceHistory,
  getProductPriceHistory,
  
  // ─── Product Batches ─────────────────────────────────────────────
  getProductBatches,
  getProductBatchAvailability,
  
  // ─── Data Explorer ───────────────────────────────────────────────
  getStockBatches,
  getFilterOptions,
  exportStockBatches,
} = require("../controllers/purchaseController");

// ─── Purchase CRUD (list/create only here — ":id" routes moved to the bottom) ──
router.post("/", auth, createPurchaseEntry);
router.get("/", auth, getPurchaseEntries);

// ─── Report Routes ──────────────────────────────────────────────────
// NOTE: These must be declared before "/:id" route
router.get("/stock-aging", auth, getStockAging);
router.get("/non-moving-stock", auth, getNonMovingStock);
router.get("/price-history/:productId", auth, getPriceHistory);
router.get("/product-price-history/:productId", auth, getProductPriceHistory);

// ─── Product Batches (for OrderCartPage) ───────────────────────────
router.post("/product-batches", auth, getProductBatches);
router.get("/product-batches/:productId/availability", auth, getProductBatchAvailability);

// ─── Data Explorer Routes ───────────────────────────────────────────
// NOTE: also must be declared before "/:id" route, otherwise "stock-batches",
// "filter-options" etc. get swallowed by "/:id" and treated as a Mongo _id.
router.get("/stock-batches", auth, getStockBatches);
router.get("/stock-batches/export", auth, exportStockBatches);
router.get("/filter-options", auth, getFilterOptions);

// ─── Single purchase routes (must come LAST — "/:id" matches anything) ─────
router.get("/:id", auth, getPurchaseEntryById);
router.put("/:id", auth, updatePurchaseEntry);

module.exports = router;


//---------- 13.08.2026 -------------------
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
//   getProductBatchAvailability,
//   getStockBatches
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
// // Add this route to the existing router
// router.get("/stock-batches", auth, getStockBatches);

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

