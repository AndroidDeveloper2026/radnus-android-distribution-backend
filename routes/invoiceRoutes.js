const express = require("express");
const router = express.Router();
const { createInvoice, getInvoices, updateInvoiceStatus} = require("../controllers/invoiceController");

router.post("/", createInvoice);
router.get("/", getInvoices);
router.patch("/:id", updateInvoiceStatus);
// DELETE /api/invoices/:invoiceNumber
router.delete("/api/invoices/:invoiceNumber", async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    const deleted = await Invoice.findOneAndDelete({ invoiceNumber });
    if (!deleted) {
      return res.status(404).json({ msg: "Invoice not found" });
    }
    res.json({ msg: "Invoice deleted successfully" });
  } catch (err) {
    res.status(500).json({ msg: err.message });
  }
});

module.exports = router;