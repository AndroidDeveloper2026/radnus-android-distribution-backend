// routes/invoiceRoutes.js

const express = require("express");
const router = express.Router();
const { 
  createInvoice, 
  getInvoices, 
  updateInvoiceStatus, 
  deleteInvoice,
  getInvoiceByNumber,  // Add this if you want to fetch by number
} = require("../controllers/invoiceController");

// Create invoice
router.post("/", createInvoice);

// Get all invoices
router.get("/", getInvoices);

// Get invoice by number
router.get("/:invoiceNumber", getInvoiceByNumber);  // Optional

// Update invoice status
router.patch("/:id", updateInvoiceStatus);

// Delete invoice
router.delete("/:invoiceNumber", deleteInvoice);

module.exports = router;

//-------- old working -----------
// const express = require("express");
// const router = express.Router();
// const { createInvoice, getInvoices, updateInvoiceStatus, deleteInvoice} = require("../controllers/invoiceController");

// router.post("/", createInvoice);
// router.get("/", getInvoices);
// router.patch("/:id", updateInvoiceStatus);
// // DELETE /api/invoices/:invoiceNumber
// router.delete("/:invoiceNumber", deleteInvoice);

// module.exports = router;