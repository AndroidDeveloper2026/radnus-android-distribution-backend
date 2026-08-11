// controllers/invoiceController.js - COMPLETE FIXED VERSION

const mongoose = require('mongoose');
const Invoice = require("../models/Invoice/InvoiceModel");
const StockBatch = require("../models/Purchase/StockBatch");
const StockMovement = require("../models/Purchase/StockMovement");
const Product = require("../models/AdminModel/Product");

const getFinancialYear = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
};

const createInvoice = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();
    
    const {
      items,
      totalAmount,
      paymentMode,
      billerName,
      status,
      customerPhone,
      customerName,
      customerType,
      shopName,
      customerAddress,
      customerCity,
      customerState,
      sameAsBuyer,
      shippingAddress,
      subtotal,
      discount,
      courierCharge,
      salesperson,
      referenceNo,
      invoiceDate,
      orderType,
      priceType,
      allowDefaultBatches = true,
      hasDefaultBatches = false,
    } = req.body;

    // Validate required fields
    if (!customerPhone || !customerName || !items || !items.length || !totalAmount || !paymentMode) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ 
        success: false,
        message: "Missing required invoice fields" 
      });
    }

    console.log(`📝 Creating invoice for ${customerName}, ${items.length} items`);

    // ✅ STEP 1: Process each item and reduce stock
    for (const item of items) {
      // Find product
      const product = await Product.findById(item.productId).session(session);
      
      if (!product) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ 
          success: false,
          message: `Product not found: ${item.name}` 
        });
      }

      // ✅ Check if product has enough stock
      const currentStock = product.moq || 0;
      if (currentStock < item.qty) {
        await session.abortTransaction();
        session.endSession();
        return res.status(409).json({ 
          success: false,
          code: 'INSUFFICIENT_STOCK',
          message: `Insufficient stock for ${item.name}. Available: ${currentStock}, Requested: ${item.qty}`
        });
      }

      // ✅ REDUCE PRODUCT STOCK (moq)
      product.moq = currentStock - item.qty;
      await product.save({ session });
      console.log(`📉 Stock decreased for ${product.name}: ${currentStock} → ${product.moq}`);

      // ✅ Process batch allocations if they exist
      if (item.batchAllocations && item.batchAllocations.length > 0) {
        for (const alloc of item.batchAllocations) {
          // Skip DEFAULT batches if they exist
          if (alloc.batchNumber === 'DEFAULT' || alloc.isDefault) {
            console.log(`ℹ️ Skipping DEFAULT batch for ${item.name}`);
            continue;
          }

          // Find the batch by batchNo
          const batch = await StockBatch.findOne({ 
            batchNo: alloc.batchNumber,
            productId: item.productId
          }).session(session);
          
          if (!batch) {
            // If batch not found but we have default batches allowed, continue
            if (allowDefaultBatches) {
              console.log(`⚠️ Batch ${alloc.batchNumber} not found, but default batches allowed`);
              continue;
            }
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ 
              success: false,
              message: `Batch ${alloc.batchNumber} not found for product ${item.name}`
            });
          }
          
          // ✅ Check if enough stock in batch
          if (batch.quantityAvailable < alloc.qty) {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({ 
              success: false,
              code: 'INSUFFICIENT_STOCK',
              message: `Insufficient stock for batch ${alloc.batchNumber}. ` +
                       `Available: ${batch.quantityAvailable}, Requested: ${alloc.qty}`
            });
          }
          
          // ✅ Reduce batch available quantity
          batch.quantityAvailable -= alloc.qty;
          await batch.save({ session });
          console.log(`📉 Batch stock decreased for ${alloc.batchNumber}: ${batch.quantityAvailable + alloc.qty} → ${batch.quantityAvailable}`);
          
          // ✅ Create stock movement (sale)
          await StockMovement.create([{
            productId: batch.productId,
            batchNo: batch.batchNo,
            type: "sale",
            quantity: -alloc.qty,
            referenceType: "Invoice",
            referenceId: null, // Will be updated after invoice creation
          }], { session });
        }
      } else {
        // ✅ No batches - just log it
        console.log(`ℹ️ No batches for ${item.name}, stock reduced via product only`);
      }
    }

    // ✅ STEP 2: Generate invoice number
    const financialYear = getFinancialYear();
    const lastInvoice = await Invoice.findOne({ financialYear }).sort({ sequence: -1 }).session(session);
    const nextSequence = lastInvoice ? lastInvoice.sequence + 1 : 1;
    const paddedSequence = String(nextSequence).padStart(3, "0");
    const invoiceNumber = `RC${financialYear}/${paddedSequence}`;

    console.log(`📄 Generating invoice number: ${invoiceNumber}`);

    // ✅ STEP 3: Create invoice
    const invoice = await Invoice.create([{
      invoiceNumber,
      financialYear,
      sequence: nextSequence,
      billerName: billerName || "Unknown",
      items: items.map(item => ({
        productId: item.productId,
        name: item.name,
        qty: item.qty,
        price: item.price,
        batchAllocations: item.batchAllocations || [],
        useDefaultPrice: item.useDefaultPrice || false,
      })),
      totalAmount,
      paymentMode,
      status: status || "completed",
      customerPhone,
      customerName,
      customerType: customerType || "customer",
      shopName: shopName || "",
      customerAddress: customerAddress || "",
      customerCity: customerCity || "",
      customerState: customerState || "",
      sameAsBuyer: sameAsBuyer !== undefined ? sameAsBuyer : true,
      shippingAddress: sameAsBuyer ? {} : (shippingAddress || {}),
      subtotal: subtotal || totalAmount - (courierCharge || 0),
      discount: discount || 0,
      courierCharge: courierCharge || 0,
      salesperson: salesperson || "",
      referenceNo: referenceNo || "",
      invoiceDate: invoiceDate || new Date(),
      orderType: orderType || '',
      priceType: priceType || 'retailerPrice',
    }], { session });

    // ✅ STEP 4: Update stock movements with invoice reference
    await StockMovement.updateMany(
      { 
        referenceType: "Invoice",
        referenceId: null
      },
      { referenceId: invoice[0]._id },
      { session }
    );

    await session.commitTransaction();
    
    console.log(`✅ Invoice created successfully: ${invoiceNumber}`);
    
    res.status(201).json({
      success: true,
      invoice: {
        id: invoice[0]._id,
        invoiceNumber: invoice[0].invoiceNumber,
        date: invoice[0].invoiceDate,
        totalAmount: invoice[0].totalAmount,
      },
    });
    
  } catch (err) {
    await session.abortTransaction();
    console.error("❌ createInvoice error:", err);
    res.status(500).json({ 
      success: false,
      message: err.message 
    });
  } finally {
    session.endSession();
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

    if (billerName && billerName.trim() !== "") {
      query.billerName = billerName;
    }

    if (status && status.trim() !== "") {
      query.status = status;
    }

    const invoices = await Invoice.find(query).sort({ createdAt: -1 });
    res.json(invoices);
  } catch (err) {
    console.error("getInvoices error:", err);
    res.status(500).json({ message: err.message });
  }
};

const updateInvoiceStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['draft', 'completed'].includes(status)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid status. Must be "draft" or "completed"' 
      });
    }

    const invoice = await Invoice.findOneAndUpdate(
      { invoiceNumber: id },
      { status },
      { new: true }
    );

    if (!invoice) {
      return res.status(404).json({ 
        success: false,
        message: 'Invoice not found' 
      });
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
      return res.status(404).json({ 
        success: false,
        msg: "Invoice not found" 
      });
    }

    res.json({ 
      success: true,
      msg: "Invoice deleted successfully" 
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      msg: err.message 
    });
  }
};

module.exports = { 
  createInvoice, 
  getInvoices, 
  updateInvoiceStatus,
  deleteInvoice,
};
//----------- 11.08.2026 ---------------------
// // controllers/invoiceController.js
// const mongoose = require('mongoose');
// const Invoice = require("../models/Invoice/InvoiceModel");
// const StockBatch = require("../models/Purchase/StockBatch");
// const StockMovement = require("../models/Purchase/StockMovement");
// const Product = require("../models/AdminModel/Product");

// const getFinancialYear = () => {
//   const now = new Date();
//   const year = now.getFullYear();
//   const month = now.getMonth() + 1;
//   return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
// };

// const createInvoice = async (req, res) => {
//   const session = await mongoose.startSession();
  
//   try {
//     session.startTransaction();
    
//     const {
//       items,
//       totalAmount,
//       paymentMode,
//       billerName,
//       status,
//       customerPhone,
//       customerName,
//       customerType,
//       shopName,
//       customerAddress,
//       customerCity,
//       customerState,
//       sameAsBuyer,
//       shippingAddress,
//       subtotal,
//       discount,
//       courierCharge,
//       salesperson,
//       referenceNo,
//       invoiceDate,
//       orderType,
//       priceType,
//     } = req.body;

//     if (!customerPhone || !customerName || !items || !items.length || !totalAmount || !paymentMode) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(400).json({ message: "Missing required invoice fields" });
//     }

//     // ✅ STEP 1: Reduce stock for each batch allocation
//     for (const item of items) {
//       if (item.batchAllocations && item.batchAllocations.length > 0) {
//         for (const alloc of item.batchAllocations) {
//           // Find the batch by batchNo
//           const batch = await StockBatch.findOne({ 
//             batchNo: alloc.batchNumber 
//           }).session(session);
          
//           if (!batch) {
//             await session.abortTransaction();
//             session.endSession();
//             return res.status(404).json({ 
//               message: `Batch ${alloc.batchNumber} not found` 
//             });
//           }
          
//           // ✅ Check if enough stock
//           if (batch.quantityAvailable < alloc.qty) {
//             await session.abortTransaction();
//             session.endSession();
//             return res.status(409).json({ 
//               code: 'INSUFFICIENT_STOCK',
//               message: `Insufficient stock for batch ${alloc.batchNumber}. ` +
//                        `Available: ${batch.quantityAvailable}, Requested: ${alloc.qty}`
//             });
//           }
          
//           // ✅ Reduce available quantity
//           batch.quantityAvailable -= alloc.qty;
//           await batch.save({ session });
          
//           // ✅ Create stock movement (sale)
//           await StockMovement.create([{
//             productId: batch.productId,
//             batchNo: batch.batchNo,
//             type: "sale",
//             quantity: -alloc.qty,  // Negative for sale
//             referenceType: "Invoice",
//           }], { session });
          
//           // ✅ Reduce product stock (moq)
//           await Product.findByIdAndUpdate(
//             batch.productId,
//             { $inc: { moq: -alloc.qty } },
//             { session }
//           );
//         }
//       }
//     }

//     // ✅ STEP 2: Generate invoice number
//     const financialYear = getFinancialYear();
//     const lastInvoice = await Invoice.findOne({ financialYear }).sort({ sequence: -1 }).session(session);
//     const nextSequence = lastInvoice ? lastInvoice.sequence + 1 : 1;
//     const paddedSequence = String(nextSequence).padStart(3, "0");
//     const invoiceNumber = `RC${financialYear}/${paddedSequence}`;

//     // ✅ STEP 3: Create invoice
//     const invoice = await Invoice.create([{
//       invoiceNumber,
//       financialYear,
//       sequence: nextSequence,
//       billerName,
//       items,
//       totalAmount,
//       paymentMode,
//       status: status || "completed",
//       customerPhone,
//       customerName,
//       customerType: customerType || "customer",
//       shopName: shopName || "",
//       customerAddress: customerAddress || "",
//       customerCity: customerCity || "",
//       customerState: customerState || "",
//       sameAsBuyer: sameAsBuyer !== undefined ? sameAsBuyer : true,
//       shippingAddress: sameAsBuyer ? {} : (shippingAddress || {}),
//       subtotal: subtotal || totalAmount - (courierCharge || 0),
//       discount: discount || 0,
//       courierCharge: courierCharge || 0,
//       salesperson: salesperson || "",
//       referenceNo: referenceNo || "",
//       invoiceDate: invoiceDate || new Date(),
//       orderType: orderType || '',
//       priceType: priceType || 'retailerPrice',
//     }], { session });

//     await session.commitTransaction();
    
//     res.status(201).json({
//       success: true,
//       invoice: {
//         id: invoice[0]._id,
//         invoiceNumber: invoice[0].invoiceNumber,
//         date: invoice[0].invoiceDate,
//         totalAmount: invoice[0].totalAmount,
//       },
//     });
    
//   } catch (err) {
//     await session.abortTransaction();
//     console.error("createInvoice error:", err);
//     res.status(500).json({ message: err.message });
//   } finally {
//     session.endSession();
//   }
// };

// const getInvoices = async (req, res) => {
//   try {
//     const { filter, billerName, status } = req.query;
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
//       const start = new Date(now);
//       start.setDate(now.getDate() - 7);
//       start.setHours(0, 0, 0, 0);
//       query.createdAt = { $gte: start, $lte: now };
//     } else if (filter === "month") {
//       const start = new Date(now);
//       start.setMonth(now.getMonth() - 1);
//       start.setHours(0, 0, 0, 0);
//       query.createdAt = { $gte: start, $lte: now };
//     }

//     if (billerName && billerName.trim() !== "") {
//       query.billerName = billerName;
//     }

//     if (status && status.trim() !== "") {
//       query.status = status;
//     }

//     const invoices = await Invoice.find(query).sort({ createdAt: -1 });
//     res.json(invoices);
//   } catch (err) {
//     console.error("getInvoices error:", err);
//     res.status(500).json({ message: err.message });
//   }
// };

// const updateInvoiceStatus = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { status } = req.body;

//     if (!['draft', 'completed'].includes(status)) {
//       return res.status(400).json({ 
//         message: 'Invalid status. Must be "draft" or "completed"' 
//       });
//     }

//     const invoice = await Invoice.findOneAndUpdate(
//       { invoiceNumber: id },
//       { status },
//       { new: true }
//     );

//     if (!invoice) {
//       return res.status(404).json({ message: 'Invoice not found' });
//     }

//     res.json({
//       success: true,
//       invoice,
//     });
//   } catch (err) {
//     console.error("updateInvoiceStatus error:", err);
//     res.status(500).json({ message: err.message });
//   }
// };

// const deleteInvoice = async (req, res) => {
//   try {
//     const { invoiceNumber } = req.params;

//     const deleted = await Invoice.findOneAndDelete({ invoiceNumber });

//     if (!deleted) {
//       return res.status(404).json({ msg: "Invoice not found" });
//     }

//     res.json({ msg: "Invoice deleted successfully" });
//   } catch (err) {
//     res.status(500).json({ msg: err.message });
//   }
// };

// module.exports = { 
//   createInvoice, 
//   getInvoices, 
//   updateInvoiceStatus,
//   deleteInvoice,
// };

// //-------- working code before qty -------------
// // const Invoice = require("../models/Invoice/InvoiceModel");

// // const getFinancialYear = () => {
// //   const now = new Date();
// //   const year = now.getFullYear();
// //   const month = now.getMonth() + 1;
// //   return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
// // };


// // const createInvoice = async (req, res) => {
// //   try {
// //     const {
// //       items,
// //       totalAmount,
// //       paymentMode,
// //       billerName,
// //       status,
// //       customerPhone,
// //       customerName,
// //       customerType,
// //       shopName,
// //       customerAddress,
// //       customerCity,
// //       customerState,
// //       sameAsBuyer,
// //       shippingAddress,
// //       subtotal,
// //       discount,           // 🆕
// //       courierCharge,
// //       salesperson,
// //       referenceNo,
// //       invoiceDate,
// //       orderType,
// //     } = req.body;

// //     if (!customerPhone || !customerName || !items || !items.length || !totalAmount || !paymentMode) {
// //       return res.status(400).json({ message: "Missing required invoice fields" });
// //     }

// //     const financialYear = getFinancialYear();
// //     const lastInvoice = await Invoice.findOne({ financialYear }).sort({ sequence: -1 });
// //     const nextSequence = lastInvoice ? lastInvoice.sequence + 1 : 1;
// //     const paddedSequence = String(nextSequence).padStart(3, "0");
// //     const invoiceNumber = `RC${financialYear}/${paddedSequence}`;

// //     const invoice = await Invoice.create({
// //       invoiceNumber,
// //       financialYear,
// //       sequence: nextSequence,
// //       billerName,
// //       items,
// //       totalAmount,
// //       paymentMode,
// //       status: status || "completed",
// //       customerPhone,
// //       customerName,
// //       customerType: customerType || "customer",
// //       shopName: shopName || "",
// //       customerAddress: customerAddress || "",
// //       customerCity: customerCity || "",
// //       customerState: customerState || "",
// //       sameAsBuyer: sameAsBuyer !== undefined ? sameAsBuyer : true,
// //       shippingAddress: sameAsBuyer ? {} : (shippingAddress || {}),
// //       subtotal: subtotal || totalAmount - (courierCharge || 0),
// //       discount: discount || 0,                   // ✅ include discount
// //       courierCharge: courierCharge || 0,
// //       salesperson: salesperson || "",
// //       referenceNo: referenceNo || "",
// //       invoiceDate: invoiceDate || new Date(),
// //       orderType: orderType || '', 
// //     });

// //     res.status(201).json({
// //       success: true,
// //       invoice: {
// //         id: invoice._id,
// //         invoiceNumber: invoice.invoiceNumber,
// //         date: invoice.invoiceDate,
// //         totalAmount: invoice.totalAmount,
// //       },
// //     });
// //   } catch (err) {
// //     console.error("createInvoice error:", err);
// //     res.status(500).json({ message: err.message });
// //   }
// // };

// // // ✅ GET INVOICES (WITH STATUS FILTER) - FIXED
// // const getInvoices = async (req, res) => {
// //   try {
// //     const { filter, billerName, status } = req.query;
// //     let query = {};
// //     const now = new Date();

// //     const getDayRange = (date) => {
// //       const start = new Date(date);
// //       start.setHours(0, 0, 0, 0);
// //       const end = new Date(date);
// //       end.setHours(23, 59, 59, 999);
// //       return { start, end };
// //     };

// //     // ✅ Apply date filter
// //     if (filter === "today") {
// //       const { start, end } = getDayRange(now);
// //       query.createdAt = { $gte: start, $lte: end };
// //     } else if (filter === "week") {
// //       const start = new Date(now);
// //       start.setDate(now.getDate() - 7);
// //       start.setHours(0, 0, 0, 0);
// //       query.createdAt = { $gte: start, $lte: now };
// //     } else if (filter === "month") {
// //       const start = new Date(now);
// //       start.setMonth(now.getMonth() - 1);
// //       start.setHours(0, 0, 0, 0);
// //       query.createdAt = { $gte: start, $lte: now };
// //     }
// //     // If filter === "all", no date filter

// //     // ✅ Apply biller name filter
// //     if (billerName && billerName.trim() !== "") {
// //       query.billerName = billerName;
// //     }

// //     // ✅ CRITICAL FIX: Apply status filter
// //     if (status && status.trim() !== "") {
// //       query.status = status; // ← Now properly filters
// //     }

// //     const invoices = await Invoice.find(query).sort({ createdAt: -1 });

// //     res.json(invoices);
// //   } catch (err) {
// //     console.error("getInvoices error:", err);
// //     res.status(500).json({ message: err.message });
// //   }
// // };

// // // ✅ UPDATE STATUS
// // const updateInvoiceStatus = async (req, res) => {
// //   try {
// //     const { id } = req.params;
// //     const { status } = req.body;

// //     // ✅ Validate status
// //     if (!['draft', 'completed'].includes(status)) {
// //       return res.status(400).json({ 
// //         message: 'Invalid status. Must be "draft" or "completed"' 
// //       });
// //     }

// //     const invoice = await Invoice.findOneAndUpdate(
// //       { invoiceNumber: id },
// //       { status },
// //       { new: true }
// //     );

// //     if (!invoice) {
// //       return res.status(404).json({ message: 'Invoice not found' });
// //     }

// //     res.json({
// //       success: true,
// //       invoice,
// //     });
// //   } catch (err) {
// //     console.error("updateInvoiceStatus error:", err);
// //     res.status(500).json({ message: err.message });
// //   }
// // };


// // const deleteInvoice = async (req, res) => {
// //   try {
// //     const { invoiceNumber } = req.params;

// //     const deleted = await Invoice.findOneAndDelete({ invoiceNumber });

// //     if (!deleted) {
// //       return res.status(404).json({ msg: "Invoice not found" });
// //     }

// //     res.json({ msg: "Invoice deleted successfully" });
// //   } catch (err) {
// //     res.status(500).json({ msg: err.message });
// //   }
// // };

// // module.exports = { 
// //   createInvoice, 
// //   getInvoices, 
// //   updateInvoiceStatus,
// //   deleteInvoice, // ← Don't forget to add to routes!
// // };