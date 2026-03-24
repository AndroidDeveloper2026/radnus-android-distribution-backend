const Invoice = require("../models/Invoice/InvoiceModel");

// 🔥 helper: financial year
const getFinancialYear = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  return month >= 4
    ? `${year}-${year + 1}`
    : `${year - 1}-${year}`;
};

const createInvoice = async (req, res) => {
  try {
    const {
      customerPhone,
      items,
      totalAmount,
      paymentMode,
      billerName, // 🔥 NEW
    } = req.body;

    const financialYear = getFinancialYear();

    const lastInvoice = await Invoice.findOne({ financialYear })
      .sort({ sequence: -1 });

    const nextSequence = lastInvoice ? lastInvoice.sequence + 1 : 1;

    const paddedSequence = String(nextSequence).padStart(3, "0");

    const invoiceNumber = `RC${financialYear}/${paddedSequence}`;

    const invoice = await Invoice.create({
      invoiceNumber,
      financialYear,
      sequence: nextSequence,
      customerPhone,
      billerName, // 🔥 SAVE HERE
      items,
      totalAmount,
      paymentMode,
    });

    res.status(201).json({
      success: true,
      invoice,
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createInvoice };