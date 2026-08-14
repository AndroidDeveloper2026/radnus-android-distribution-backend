// controllers/invoiceController.js
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
      gstAmount,
      salesperson,
      referenceNo,
      invoiceDate,
      orderType,
      priceType,
    } = req.body;

    if (!customerPhone || !customerName || !items || !items.length || !totalAmount || !paymentMode) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Missing required invoice fields" });
    }

    // ✅ STEP 1: Reduce stock for each item.
    // Two paths are supported:
    //   a) The client already picked specific batches (item.batchAllocations
    //      has entries) -> reduce exactly those batches, as before.
    //   b) The client did NOT resolve a batch (e.g. "useDefaultPrice"/"noBatch"
    //      items from the cart, or products that were never batch-tracked in
    //      the first place). Previously this case silently reduced NOTHING,
    //      which is why stock quantities stopped decreasing after a sale.
    //      Now we auto-allocate FIFO (oldest batch first) on the server so
    //      stock is always reduced regardless of what the frontend sent.
    for (const item of items) {
      const productId = item.productId;
      const qtyNeeded = Number(item.qty) || 0;

      if (!productId || qtyNeeded <= 0) {
        continue;
      }

      const explicitAllocations =
        item.batchAllocations && item.batchAllocations.length > 0
          ? item.batchAllocations
          : null;

      if (explicitAllocations) {
        // ── Path a: client-specified batch allocations ──────────────────
        for (const alloc of explicitAllocations) {
          const allocQty = Number(alloc.qty) || 0;
          if (allocQty <= 0) continue;

          const batch = await StockBatch.findOne({
            batchNo: alloc.batchNumber,
          }).session(session);

          if (!batch) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
              message: `Batch ${alloc.batchNumber} not found`,
            });
          }

          if (batch.quantityAvailable < allocQty) {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({
              code: "INSUFFICIENT_STOCK",
              message: `Insufficient stock for batch ${alloc.batchNumber}. ` +
                       `Available: ${batch.quantityAvailable}, Requested: ${allocQty}`,
            });
          }

          batch.quantityAvailable -= allocQty;
          await batch.save({ session });

          await StockMovement.create([{
            productId: batch.productId,
            batchNo: batch.batchNo,
            type: "sale",
            quantity: -allocQty,
            referenceType: "Invoice",
          }], { session });

          await Product.findByIdAndUpdate(
            batch.productId,
            { $inc: { moq: -allocQty } },
            { session }
          );
        }
      } else {
        // ── Path b: no batch chosen by the client -> auto-allocate FIFO ─
        const availableBatches = await StockBatch.find({
          productId,
          quantityAvailable: { $gt: 0 },
        })
          .sort({ inwardDate: 1, createdAt: 1 }) // oldest stock first
          .session(session);

        const totalAvailable = availableBatches.reduce(
          (sum, b) => sum + b.quantityAvailable,
          0
        );

        if (availableBatches.length > 0) {
          if (totalAvailable < qtyNeeded) {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({
              code: "INSUFFICIENT_STOCK",
              message: `Insufficient stock for ${item.name || productId}. ` +
                       `Available: ${totalAvailable}, Requested: ${qtyNeeded}`,
            });
          }

          let remaining = qtyNeeded;
          const autoAllocations = [];

          for (const batch of availableBatches) {
            if (remaining <= 0) break;

            const take = Math.min(batch.quantityAvailable, remaining);
            batch.quantityAvailable -= take;
            await batch.save({ session });

            await StockMovement.create([{
              productId: batch.productId,
              batchNo: batch.batchNo,
              type: "sale",
              quantity: -take,
              referenceType: "Invoice",
            }], { session });

            autoAllocations.push({
              batchId: batch._id,
              batchNo: batch.batchNo,
              qty: take,
              purchaseCost: batch.purchasePrice || 0,
            });

            remaining -= take;
          }

          await Product.findByIdAndUpdate(
            productId,
            { $inc: { moq: -qtyNeeded } },
            { session }
          );

          // Persist the batches that were actually consumed on the invoice
          // item so reports/returns can still trace them later.
          item.batchAllocations = autoAllocations;
        } else {
          // No batches exist for this product at all (e.g. legacy product
          // whose stock was never entered via the batch-purchase flow).
          // Fall back to reducing the flat product stock (moq) directly.
          const product = await Product.findById(productId).session(session);

          if (!product) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
              message: `Product ${item.name || productId} not found`,
            });
          }

          if ((product.moq || 0) < qtyNeeded) {
            await session.abortTransaction();
            session.endSession();
            return res.status(409).json({
              code: "INSUFFICIENT_STOCK",
              message: `Insufficient stock for ${item.name || productId}. ` +
                       `Available: ${product.moq || 0}, Requested: ${qtyNeeded}`,
            });
          }

          product.moq = (product.moq || 0) - qtyNeeded;
          await product.save({ session });

          await StockMovement.create([{
            productId,
            batchNo: "",
            type: "sale",
            quantity: -qtyNeeded,
            referenceType: "Invoice",
          }], { session });
        }
      }
    }

    // ✅ STEP 2: Generate invoice number
    const financialYear = getFinancialYear();
    const lastInvoice = await Invoice.findOne({ financialYear }).sort({ sequence: -1 }).session(session);
    const nextSequence = lastInvoice ? lastInvoice.sequence + 1 : 1;
    const paddedSequence = String(nextSequence).padStart(3, "0");
    const invoiceNumber = `RC${financialYear}/${paddedSequence}`;

    // ✅ STEP 3: Create invoice
    const invoice = await Invoice.create([{
      invoiceNumber,
      financialYear,
      sequence: nextSequence,
      billerName,
      items,
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
      gstAmount: gstAmount || 0,
      salesperson: salesperson || "",
      referenceNo: referenceNo || "",
      invoiceDate: invoiceDate || new Date(),
      orderType: orderType || '',
      priceType: priceType || 'retailerPrice',
    }], { session });

    await session.commitTransaction();
    
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
    console.error("createInvoice error:", err);
    res.status(500).json({ message: err.message });
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
  deleteInvoice,
};

//------------------- 14.08.2026 --------------------
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

//     // ✅ STEP 1: Reduce stock for each item.
//     // Two paths are supported:
//     //   a) The client already picked specific batches (item.batchAllocations
//     //      has entries) -> reduce exactly those batches, as before.
//     //   b) The client did NOT resolve a batch (e.g. "useDefaultPrice"/"noBatch"
//     //      items from the cart, or products that were never batch-tracked in
//     //      the first place). Previously this case silently reduced NOTHING,
//     //      which is why stock quantities stopped decreasing after a sale.
//     //      Now we auto-allocate FIFO (oldest batch first) on the server so
//     //      stock is always reduced regardless of what the frontend sent.
//     for (const item of items) {
//       const productId = item.productId;
//       const qtyNeeded = Number(item.qty) || 0;

//       if (!productId || qtyNeeded <= 0) {
//         continue;
//       }

//       const explicitAllocations =
//         item.batchAllocations && item.batchAllocations.length > 0
//           ? item.batchAllocations
//           : null;

//       if (explicitAllocations) {
//         // ── Path a: client-specified batch allocations ──────────────────
//         for (const alloc of explicitAllocations) {
//           const allocQty = Number(alloc.qty) || 0;
//           if (allocQty <= 0) continue;

//           const batch = await StockBatch.findOne({
//             batchNo: alloc.batchNumber,
//           }).session(session);

//           if (!batch) {
//             await session.abortTransaction();
//             session.endSession();
//             return res.status(404).json({
//               message: `Batch ${alloc.batchNumber} not found`,
//             });
//           }

//           if (batch.quantityAvailable < allocQty) {
//             await session.abortTransaction();
//             session.endSession();
//             return res.status(409).json({
//               code: "INSUFFICIENT_STOCK",
//               message: `Insufficient stock for batch ${alloc.batchNumber}. ` +
//                        `Available: ${batch.quantityAvailable}, Requested: ${allocQty}`,
//             });
//           }

//           batch.quantityAvailable -= allocQty;
//           await batch.save({ session });

//           await StockMovement.create([{
//             productId: batch.productId,
//             batchNo: batch.batchNo,
//             type: "sale",
//             quantity: -allocQty,
//             referenceType: "Invoice",
//           }], { session });

//           await Product.findByIdAndUpdate(
//             batch.productId,
//             { $inc: { moq: -allocQty } },
//             { session }
//           );
//         }
//       } else {
//         // ── Path b: no batch chosen by the client -> auto-allocate FIFO ─
//         const availableBatches = await StockBatch.find({
//           productId,
//           quantityAvailable: { $gt: 0 },
//         })
//           .sort({ inwardDate: 1, createdAt: 1 }) // oldest stock first
//           .session(session);

//         const totalAvailable = availableBatches.reduce(
//           (sum, b) => sum + b.quantityAvailable,
//           0
//         );

//         if (availableBatches.length > 0) {
//           if (totalAvailable < qtyNeeded) {
//             await session.abortTransaction();
//             session.endSession();
//             return res.status(409).json({
//               code: "INSUFFICIENT_STOCK",
//               message: `Insufficient stock for ${item.name || productId}. ` +
//                        `Available: ${totalAvailable}, Requested: ${qtyNeeded}`,
//             });
//           }

//           let remaining = qtyNeeded;
//           const autoAllocations = [];

//           for (const batch of availableBatches) {
//             if (remaining <= 0) break;

//             const take = Math.min(batch.quantityAvailable, remaining);
//             batch.quantityAvailable -= take;
//             await batch.save({ session });

//             await StockMovement.create([{
//               productId: batch.productId,
//               batchNo: batch.batchNo,
//               type: "sale",
//               quantity: -take,
//               referenceType: "Invoice",
//             }], { session });

//             autoAllocations.push({
//               batchId: batch._id,
//               batchNo: batch.batchNo,
//               qty: take,
//               purchaseCost: batch.purchasePrice || 0,
//             });

//             remaining -= take;
//           }

//           await Product.findByIdAndUpdate(
//             productId,
//             { $inc: { moq: -qtyNeeded } },
//             { session }
//           );

//           // Persist the batches that were actually consumed on the invoice
//           // item so reports/returns can still trace them later.
//           item.batchAllocations = autoAllocations;
//         } else {
//           // No batches exist for this product at all (e.g. legacy product
//           // whose stock was never entered via the batch-purchase flow).
//           // Fall back to reducing the flat product stock (moq) directly.
//           const product = await Product.findById(productId).session(session);

//           if (!product) {
//             await session.abortTransaction();
//             session.endSession();
//             return res.status(404).json({
//               message: `Product ${item.name || productId} not found`,
//             });
//           }

//           if ((product.moq || 0) < qtyNeeded) {
//             await session.abortTransaction();
//             session.endSession();
//             return res.status(409).json({
//               code: "INSUFFICIENT_STOCK",
//               message: `Insufficient stock for ${item.name || productId}. ` +
//                        `Available: ${product.moq || 0}, Requested: ${qtyNeeded}`,
//             });
//           }

//           product.moq = (product.moq || 0) - qtyNeeded;
//           await product.save({ session });

//           await StockMovement.create([{
//             productId,
//             batchNo: "",
//             type: "sale",
//             quantity: -qtyNeeded,
//             referenceType: "Invoice",
//           }], { session });
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

