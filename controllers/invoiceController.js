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

//----------------new code---------------

// backend/controllers/invoiceController.js
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Product = require('../models/Product');

exports.updateInvoice = async (req, res) => {
  const { id } = req.params;
  const { status, paymentMode, referenceNo, courierCharge, salesperson, confirmedBy, confirmedAt, shipToName, shipToPhone, shipToAddress, shipToCity, shipToState } = req.body;

  // Only handle atomic completion when status changes to 'completed'
  if (status === 'completed') {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // 1. Fetch the draft invoice
      const invoice = await Invoice.findById(id).session(session);
      if (!invoice) {
        await session.abortTransaction();
        return res.status(404).json({ success: false, error: 'Invoice not found' });
      }
      
      if (invoice.status !== 'draft') {
        await session.abortTransaction();
        return res.status(400).json({ success: false, error: 'Invoice must be in draft status to complete' });
      }

      // 2. Validate and reduce stock for each item (ATOMIC)
      for (const item of invoice.items) {
        const product = await Product.findById(item.productId).session(session);
        if (!product) {
          await session.abortTransaction();
          return res.status(400).json({ success: false, error: `Product not found: ${item.name}` });
        }
        
        // Check available stock (moq represents total stock in your schema)
        if (product.moq < item.qty) {
          await session.abortTransaction();
          return res.status(400).json({ 
            success: false, 
            error: `Insufficient stock for ${product.name}. Available: ${product.moq}, Requested: ${item.qty}` 
          });
        }
        
        // Reduce stock
        product.moq -= item.qty;
        await product.save({ session });
      }
      
      // 3. Update invoice to completed status with all confirmation details
      invoice.status = 'completed';
      if (paymentMode) invoice.paymentMode = paymentMode;
      if (referenceNo) invoice.referenceNo = referenceNo;
      if (courierCharge !== undefined) invoice.courierCharge = courierCharge;
      if (salesperson) invoice.salesperson = salesperson;
      if (confirmedBy) invoice.confirmedBy = confirmedBy;
      if (confirmedAt) invoice.confirmedAt = confirmedAt;
      
      // Shipping address (if provided and different)
      if (shipToName) {
        invoice.shipToName = shipToName;
        invoice.shipToPhone = shipToPhone;
        invoice.shipToAddress = shipToAddress;
        invoice.shipToCity = shipToCity;
        invoice.shipToState = shipToState;
      }
      
      invoice.completedAt = new Date();
      await invoice.save({ session });
      
      // 4. COMMIT transaction - ALL or NOTHING
      await session.commitTransaction();
      
      res.json({ success: true, invoice });
      
    } catch (error) {
      // 5. ROLLBACK everything if ANY step fails
      await session.abortTransaction();
      console.error('Invoice completion transaction failed:', error);
      res.status(400).json({ success: false, error: error.message || 'Transaction failed' });
    } finally {
      session.endSession();
    }
  } else {
    // Normal update for non-completion changes (e.g., editing draft)
    const invoice = await Invoice.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }
    res.json({ success: true, invoice });
  }
};


