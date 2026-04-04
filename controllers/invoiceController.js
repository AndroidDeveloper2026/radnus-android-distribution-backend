// const Invoice = require("../models/Invoice/InvoiceModel");

// const getFinancialYear = () => {
//   const now = new Date();

//   const year = now.getFullYear();
//   const month = now.getMonth() + 1; // Jan = 1

//   // Financial year starts in April
//   if (month >= 4) {
//     return `${year}-${year + 1}`;
//   } else {
//     return `${year - 1}-${year}`;
//   }
// };

// const createInvoice = async (req, res) => {
//   try {
//     const {
//       items,
//       totalAmount,
//       paymentMode,
//       billerName,
//     } = req.body;

//     // 🔴 DEBUG LOG
//     console.log("BODY:", req.body);

//     if (!billerName) {
//       return res.status(400).json({
//         success: false,
//         message: "billerName is required",
//       });
//     }

//     if (!items || items.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: "Items are required",
//       });
//     }

//     const financialYear = getFinancialYear();

//     const lastInvoice = await Invoice.findOne({ financialYear })
//       .sort({ sequence: -1 });

//     const nextSequence = lastInvoice ? lastInvoice.sequence + 1 : 1;

//     const paddedSequence = String(nextSequence).padStart(3, "0");

//     const invoiceNumber = `RC${financialYear}/${paddedSequence}`;

//     const invoice = await Invoice.create({
//       invoiceNumber,
//       financialYear,
//       sequence: nextSequence,
//       billerName,
//       items,
//       totalAmount,
//       paymentMode,
//     });

//     res.status(201).json({
//       success: true,
//       invoice,
//     });

//   } catch (err) {
//     console.log("❌ ERROR:", err); // 🔥 VERY IMPORTANT
//     res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// // ================= GET WITH FILTER =================
// const getInvoices = async (req, res) => {
//   try {
//     const { filter } = req.query;

//     let query = {};
//     const now = new Date();

//     if (filter === "today") {
//       const start = new Date();
//       start.setHours(0, 0, 0, 0);

//       query.createdAt = { $gte: start };
//     }

//     if (filter === "week") {
//       const start = new Date();
//       start.setDate(now.getDate() - 7);

//       query.createdAt = { $gte: start };
//     }

//     if (filter === "month") {
//       const start = new Date();
//       start.setMonth(now.getMonth() - 1);

//       query.createdAt = { $gte: start };
//     }

//     const invoices = await Invoice.find(query)
//       .sort({ createdAt: -1 });

//     res.json(invoices);

//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

// module.exports = { createInvoice, getInvoices};

const Invoice = require("../models/Invoice/InvoiceModel");

const getFinancialYear = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // Jan = 1

  // Financial year starts in April
  if (month >= 4) {
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
};

const createInvoice = async (req, res) => {
  try {
    const {
      items,
      totalAmount,
      paymentMode,
      billerName,
    } = req.body;

    // ✅ Validation
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

    // ✅ Validate each item has required fields
    for (const item of items) {
      if (!item.productId || !item.qty || !item.price) {
        return res.status(400).json({
          success: false,
          message: "Each item must have productId, qty, and price",
        });
      }
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
    console.log("❌ ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// GET INVOICES WITH FILTER
const getInvoices = async (req, res) => {
  try {
    const { filter } = req.query;

    let query = {};
    const now = new Date();

    if (filter === "today") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: start };
    }

    if (filter === "week") {
      const start = new Date();
      start.setDate(now.getDate() - 7);
      query.createdAt = { $gte: start };
    }

    if (filter === "month") {
      const start = new Date();
      start.setMonth(now.getMonth() - 1);
      query.createdAt = { $gte: start };
    }

    const invoices = await Invoice.find(query)
      .sort({ createdAt: -1 });

    res.json(invoices);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET SINGLE INVOICE
const getInvoiceById = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { createInvoice, getInvoices, getInvoiceById };