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

// const getInvoices = async (req, res) => {
//   try {
//     const { filter } = req.query;

//     let query = {};
//     const now = new Date();

//     // Helper to get start and end of a day in local time, then convert to UTC
//     const getDayRange = (date) => {
//       const start = new Date(date);
//       start.setHours(0, 0, 0, 0);
//       const end = new Date(date);
//       end.setHours(23, 59, 59, 999);
//       return { start, end };
//     };

//     if (filter === "today") {
//       const { start, end } = getDayRange(now);
//       query.createdAt = { $gte: start, $lte: end };
//     }
//     else if (filter === "week") {
//       const weekAgo = new Date(now);
//       weekAgo.setDate(now.getDate() - 7);
//       weekAgo.setHours(0, 0, 0, 0);
//       query.createdAt = { $gte: weekAgo };
//     }
//     else if (filter === "month") {
//       const monthAgo = new Date(now);
//       monthAgo.setMonth(now.getMonth() - 1);
//       monthAgo.setHours(0, 0, 0, 0);
//       query.createdAt = { $gte: monthAgo };
//     }

//     const invoices = await Invoice.find(query).sort({ createdAt: -1 });
//     res.json(invoices);

//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

// module.exports = { createInvoice, getInvoices};

//---------------------------------------------

// // backend/controllers/invoiceController.js

// const Invoice = require("../models/Invoice/InvoiceModel");

// const getFinancialYear = () => {
//   const now = new Date();
//   const year = now.getFullYear();
//   const month = now.getMonth() + 1; // Jan = 1
//   if (month >= 4) {
//     return `${year}-${year + 1}`;
//   } else {
//     return `${year - 1}-${year}`;
//   }
// };

// const createInvoice = async (req, res) => {
//   try {
//     const { items, totalAmount, paymentMode, billerName } = req.body;

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
//     const lastInvoice = await Invoice.findOne({ financialYear }).sort({ sequence: -1 });
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

//     res.status(201).json({ success: true, invoice });
//   } catch (err) {
//     console.error("Create invoice error:", err);
//     res.status(500).json({ success: false, message: err.message });
//   }
// };

// const getInvoices = async (req, res) => {
//   try {
//     const { filter, billerName } = req.query;
//     let query = {};
//     const now = new Date();

//     const getDayRange = (date) => {
//       const start = new Date(date);
//       start.setHours(0, 0, 0, 0);
//       const end = new Date(date);
//       end.setHours(23, 59, 59, 999);
//       return { start, end };
//     };

//     if (filter === "today") {
//       const { start, end } = getDayRange(now);
//       query.createdAt = { $gte: start, $lte: end };
//     } else if (filter === "week") {
//       const weekAgo = new Date(now);
//       weekAgo.setDate(now.getDate() - 7);
//       weekAgo.setHours(0, 0, 0, 0);
//       query.createdAt = { $gte: weekAgo };
//     } else if (filter === "month") {
//       const monthAgo = new Date(now);
//       monthAgo.setMonth(now.getMonth() - 1);
//       monthAgo.setHours(0, 0, 0, 0);
//       query.createdAt = { $gte: monthAgo };
//     }

//     // Filter by logged-in user's name if provided
//     if (billerName && billerName.trim() !== "") {
//       query.billerName = billerName;
//     }

//     const invoices = await Invoice.find(query).sort({ createdAt: -1 });
//     res.json(invoices);
//   } catch (err) {
//     console.error("Get invoices error:", err);
//     res.status(500).json({ message: err.message });
//   }
// };

// module.exports = { createInvoice, getInvoices };

//-------------------------------

const Invoice = require("../models/Invoice/InvoiceModel");

const getFinancialYear = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // Jan = 1
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
      status = "draft",
    } = req.body;

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
    const lastInvoice = await Invoice.findOne({ financialYear }).sort({
      sequence: -1,
    });
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
      status, // ✅ store status (draft / completed)
    });

    res.status(201).json({ success: true, invoice });
  } catch (err) {
    console.error("Create invoice error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

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

    // Date filtering
    if (filter === "today") {
      const { start, end } = getDayRange(now);
      query.createdAt = { $gte: start, $lte: end };
    } else if (filter === "week") {
      const weekAgo = new Date(now);
      weekAgo.setDate(now.getDate() - 7);
      weekAgo.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: weekAgo };
    } else if (filter === "month") {
      const monthAgo = new Date(now);
      monthAgo.setMonth(now.getMonth() - 1);
      monthAgo.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: monthAgo };
    }

    // ✅ In getInvoices, ensure default behavior excludes drafts:
    if (status && status.trim() !== "") {
      query.status = status;
    } else {
      // ✅ By default, only show completed invoices in listings
      query.status = "completed";
    }

    // Filter by logged‑in user if provided
    if (billerName && billerName.trim() !== "") {
      query.billerName = billerName;
    }

    const invoices = await Invoice.find(query).sort({ createdAt: -1 });
    res.json(invoices);
  } catch (err) {
    console.error("Get invoices error:", err);
    res.status(500).json({ message: err.message });
  }
};

const updateInvoiceStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["draft", "completed"].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    const invoice = await Invoice.findByIdAndUpdate(
      id,
      { status },
      { new: true },
    );

    if (!invoice) {
      return res
        .status(404)
        .json({ success: false, message: "Invoice not found" });
    }

    res.json({ success: true, invoice });
  } catch (err) {
    console.error("Update invoice status error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createInvoice, getInvoices, updateInvoiceStatus };
