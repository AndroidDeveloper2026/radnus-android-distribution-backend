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

// ================= GET WITH FILTER =================
const getInvoices = async (req, res) => {
  try {
    const { filter } = req.query; // 'today' | 'day' | 'week' | 'month' | 'all' | undefined

    let query = {};
    const now = new Date();

    // ─── Date Range Filters (aligned with frontend logic) ───────────────
    
    // Day filter: Today only (midnight to now)
    if (filter === "today" || filter === "day") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: start };
    }

    // Week filter: Sunday to Saturday of current week
    if (filter === "week") {
      // Week starts from Sunday (matches frontend isThisWeek logic)
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
      startOfWeek.setHours(0, 0, 0, 0);
      
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6); // Saturday
      endOfWeek.setHours(23, 59, 59, 999);
      
      query.createdAt = { $gte: startOfWeek, $lte: endOfWeek };
    }

    // Month filter: Current calendar month (1st to last day)
    if (filter === "month") {
      // Current calendar month (matches frontend isThisMonth logic)
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      endOfMonth.setHours(23, 59, 59, 999);
      
      query.createdAt = { $gte: startOfMonth, $lte: endOfMonth };
    }

    // If filter is 'all' or not provided, return all invoices (no date restriction)
    // This keeps backward compatibility with existing code

    const invoices = await Invoice.find(query)
      .sort({ createdAt: -1 });

    res.json(invoices);

  } catch (err) {
    console.error("❌ GET INVOICES ERROR:", err);
    res.status(500).json({ 
      success: false,
      message: err.message 
    });
  }
};

module.exports = { 
  createInvoice, 
  getInvoices 
};