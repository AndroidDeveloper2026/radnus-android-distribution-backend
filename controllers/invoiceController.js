const InvoiceCounter = require("../models/Customer/InvoiceCounterModel");

// GET /api/invoice/generate-number
const generateInvoiceNumber = async (req, res) => {
  try {
    // Indian financial year: April to March
    const now = new Date();
    const month = now.getMonth() + 1; // 1-indexed
    const year = now.getFullYear();

    // If Jan–March → current FY started previous year
    const fyStart = month >= 4 ? year : year - 1;
    const fyEnd   = fyStart + 1;
    const financialYear = `${fyStart}-${fyEnd}`;

    // Atomically increment sequence
    const counter = await InvoiceCounter.findOneAndUpdate(
      { financialYear },
      { $inc: { sequence: 1 } },
      { new: true, upsert: true }
    );

    const padded = String(counter.sequence).padStart(3, '0');
    const invoiceNumber = `RC${financialYear}/${padded}`;

    res.status(200).json({ success: true, invoiceNumber });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

router.get('/invoice/generate-number', generateInvoiceNumber);