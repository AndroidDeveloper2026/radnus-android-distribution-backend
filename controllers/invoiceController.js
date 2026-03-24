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
      items,
      totalAmount,
      paymentMode,
      billerName,
    } = req.body;

    // 🔴 DEBUG LOG
    console.log("BODY:", req.body);

    if (!billerName) {
      return res.status(400).json({
        success: false,
        message: "billerName is required",
      });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Items are required",
      });
    }

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
      billerName,
      items,
      totalAmount,
      paymentMode,
    });

    res.status(201).json({
      success: true,
      invoice,
    });

  } catch (err) {
    console.log("❌ ERROR:", err); // 🔥 VERY IMPORTANT
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

module.exports = { createInvoice };