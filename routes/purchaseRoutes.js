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
} = require("../controllers/purchaseController");

router.post("/", auth, createPurchaseEntry);
router.get("/", auth, getPurchaseEntries);

// Report routes must be declared before "/:id" or Express will treat
// "stock-aging" / "non-moving-stock" as an :id param.
router.get("/stock-aging", auth, getStockAging);
router.get("/non-moving-stock", auth, getNonMovingStock);

router.get("/:id", auth, getPurchaseEntryById);
router.put("/:id", auth, updatePurchaseEntry);

module.exports = router;
