const express = require("express");
const router  = express.Router();
const auth    = require("../middleware/authMiddleware");

const {
  createPurchaseReturn,
  getPurchaseReturns,
  updatePurchaseReturnStatus,
  deletePurchaseReturn,
} = require("../controllers/returnsController");

// All routes protected by JWT middleware
router.post(  "/", auth, createPurchaseReturn);
router.get(   "/", auth, getPurchaseReturns);
router.patch( "/:id", auth, updatePurchaseReturnStatus);
router.delete("/:id", auth, deletePurchaseReturn);

module.exports = router;
