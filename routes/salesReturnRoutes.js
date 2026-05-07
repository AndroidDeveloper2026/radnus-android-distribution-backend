const express = require("express");
const router  = express.Router();
const auth    = require("../middleware/authMiddleware");

const {
  createSalesReturn,
  getSalesReturns,
  updateSalesReturnStatus,
  deleteSalesReturn,
} = require("../controllers/returnsController");

// All routes protected by JWT middleware
router.post(  "/", auth, createSalesReturn);
router.get(   "/", auth, getSalesReturns);
router.patch( "/:id", auth, updateSalesReturnStatus);
router.delete("/:id", auth, deleteSalesReturn);

module.exports = router;
