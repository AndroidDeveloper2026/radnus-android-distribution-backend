const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const {
  createInvoice,
  getInvoices,
  updateInvoiceStatus,
  deleteInvoice,
  getProductBatchQueue,
  previewAllocation,
} = require("../controllers/invoiceController");

// NEW — FIFO Billing routes (must be declared before "/:id"-style routes
// if any get added later; currently no conflict since these are distinct
// literal segments, but keeping the same ordering discipline as purchaseRoutes)
router.get("/batch-queue/:productId", auth, getProductBatchQueue);
router.post("/preview-allocation", auth, previewAllocation);

router.post("/", createInvoice);
router.get("/", getInvoices);
router.patch("/:id", updateInvoiceStatus);
// DELETE /api/invoices/:invoiceNumber
router.delete("/:invoiceNumber", deleteInvoice);

module.exports = router;

//============= Before FIFO ====================
// const express = require("express");
// const router = express.Router();
// const { createInvoice, getInvoices, updateInvoiceStatus, deleteInvoice} = require("../controllers/invoiceController");

// router.post("/", createInvoice);
// router.get("/", getInvoices);
// router.patch("/:id", updateInvoiceStatus);
// // DELETE /api/invoices/:invoiceNumber
// router.delete("/:invoiceNumber", deleteInvoice);

// module.exports = router;