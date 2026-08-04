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
  getOrderCartBatches,
} = require("../controllers/purchaseController");

router.post("/", auth, createPurchaseEntry);
router.get("/", auth, getPurchaseEntries);

// Report routes - must be declared before "/:id" route
router.get("/stock-aging", auth, getStockAging);
router.get("/non-moving-stock", auth, getNonMovingStock);
router.get("/price-history/:productId", auth, getPriceHistory);
router.get("/product-price-history/:productId", auth, getProductPriceHistory);

// Batch-wise pricing for the Order Cart page — must be declared before "/:id" route
router.get("/batches", auth, getOrderCartBatches);

// Single purchase routes
router.get("/:id", auth, getPurchaseEntryById);
router.put("/:id", auth, updatePurchaseEntry);

module.exports = router;


//========== working code of deepseek 4.8.26 ==========
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

