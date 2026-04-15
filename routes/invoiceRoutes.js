const express = require("express");
const router = express.Router();
const { createInvoice, getInvoices, updateInvoiceStatus} = require("../controllers/invoiceController");

router.post("/", createInvoice);
router.get("/", getInvoices);
router.patch("/:id", updateInvoiceStatus);

module.exports = router;