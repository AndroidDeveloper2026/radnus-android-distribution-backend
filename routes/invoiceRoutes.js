const express = require("express");
const router = express.Router();
const { createInvoice, getInvoices, completeInvoice } = require("../controllers/invoiceController");

router.post("/", createInvoice);
router.get("/", getInvoices);
// ✅ NEW ROUTE: Mark invoice as completed after print
router.post('/api/invoices/complete', completeInvoice);

module.exports = router;