const Invoice = require("../models/Invoice/InvoiceModel");

const getFinancialYear = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
};

// ✅ CREATE INVOICE
const createInvoice = async (req, res) => {
  try {
    const { items, totalAmount, paymentMode, billerName, status } = req.body;

    const financialYear = getFinancialYear();

    const lastInvoice = await Invoice.findOne({ financialYear }).sort({ sequence: -1 });

    const nextSequence = lastInvoice ? lastInvoice.sequence + 1 : 1;
    const paddedSequence = String(nextSequence).padStart(3, "0");

    const invoiceNumber = `RC${financialYear}/${paddedSequence}`;

    const invoice = await Invoice.create({
      invoiceNumber,
      financialYear,
      sequence: nextSequence,
      billerName,
      items,
      totalAmount,
      paymentMode,
      status: status || "draft", // ✅ Default to draft
    });

    res.status(201).json({
      success: true,
      invoice,
      invoiceNumber: invoice.invoiceNumber,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ✅ GET INVOICES (WITH STATUS FILTER) - FIXED
const getInvoices = async (req, res) => {
  try {
    const { filter, billerName, status } = req.query;
    let query = {};
    const now = new Date();

    const getDayRange = (date) => {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    };

    // ✅ Apply date filter
    if (filter === "today") {
      const { start, end } = getDayRange(now);
      query.createdAt = { $gte: start, $lte: end };
    } else if (filter === "week") {
      const start = new Date(now);
      start.setDate(now.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: start, $lte: now };
    } else if (filter === "month") {
      const start = new Date(now);
      start.setMonth(now.getMonth() - 1);
      start.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: start, $lte: now };
    }
    // If filter === "all", no date filter

    // ✅ Apply biller name filter
    if (billerName && billerName.trim() !== "") {
      query.billerName = billerName;
    }

    // ✅ CRITICAL FIX: Apply status filter
    if (status && status.trim() !== "") {
      query.status = status; // ← Now properly filters
    }

    const invoices = await Invoice.find(query).sort({ createdAt: -1 });

    res.json(invoices);
  } catch (err) {
    console.error("getInvoices error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ✅ UPDATE STATUS
const updateInvoiceStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // ✅ Validate status
    if (!['draft', 'completed'].includes(status)) {
      return res.status(400).json({ 
        message: 'Invalid status. Must be "draft" or "completed"' 
      });
    }

    const invoice = await Invoice.findOneAndUpdate(
      { invoiceNumber: id },
      { status },
      { new: true }
    );

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    res.json({
      success: true,
      invoice,
    });
  } catch (err) {
    console.error("updateInvoiceStatus error:", err);
    res.status(500).json({ message: err.message });
  }
};


const deleteInvoice = async (req, res) => {
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
};

module.exports = { 
  createInvoice, 
  getInvoices, 
  updateInvoiceStatus,
  deleteInvoice, // ← Don't forget to add to routes!
};

