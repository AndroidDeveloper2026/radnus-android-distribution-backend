const express = require("express");
const router = express.Router();
const { createInvoice, getInvoices, updateInvoiceStatus, deleteInvoice} = require("../controllers/invoiceController");

router.post("/", createInvoice);
router.get("/", getInvoices);
router.patch("/:id", updateInvoiceStatus);
// DELETE /api/invoices/:invoiceNumber
router.delete("/:invoiceNumber", deleteInvoice);

module.exports = router;