// controllers/invoiceController.js

const mongoose = require("mongoose");
const Invoice = require("../models/Invoice/InvoiceModel");
const Product = require("../models/AdminModel/Product");
const StockBatch = require("../models/Purchase/StockBatch");
const StockMovement = require("../models/Purchase/StockMovement");
const Customer = require("../models/Customer/CustomerModel");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function generateInvoiceNumber(session) {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const prefix = `INV${year}${month}${day}`;
  
  const docs = await Invoice.find({ invoiceNumber: new RegExp(`^${prefix}`) })
    .session(session || null)
    .lean();
  
  let maxSeq = 0;
  for (const d of docs) {
    const match = d.invoiceNumber?.match(/(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
}

// ─── Create Invoice ───────────────────────────────────────────────────────────

exports.createInvoice = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      billerName,
      items,
      totalAmount,
      paymentMode,
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
      batchSelections,    // ← IMPORTANT: { productId: { batchNo: qty } }
      showBatchSelector,
      priceType,
    } = req.body;

    // ─── Validation ──────────────────────────────────────────────

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error("At least one item is required");
    }

    // ─── Process each item and reduce stock ──────────────────────

    const processedItems = [];
    const stockMovements = [];

    for (const item of items) {
      const productId = item.productId;
      const orderedQty = item.qty;
      const price = item.price || 0;

      // Find product
      const product = await Product.findById(productId).session(session);
      if (!product) {
        throw new Error(`Product not found: ${item.name}`);
      }

      // Check if enough stock
      if ((product.moq || 0) < orderedQty) {
        throw new Error(`Insufficient stock for ${product.name}. Available: ${product.moq || 0}, Requested: ${orderedQty}`);
      }

      // ─── Reduce batch stock ────────────────────────────────────

      const selections = batchSelections?.[productId] || {};
      const batchEntries = Object.entries(selections).filter(([_, qty]) => qty > 0);

      if (batchEntries.length > 0) {
        // User selected specific batches - reduce those batches
        for (const [batchNo, qty] of batchEntries) {
          if (qty <= 0) continue;

          const batch = await StockBatch.findOne({
            productId: productId,
            batchNo: batchNo,
          }).session(session);

          if (!batch) {
            throw new Error(`Batch ${batchNo} not found for ${product.name}`);
          }

          if (batch.quantityAvailable < qty) {
            throw new Error(`Insufficient stock in batch ${batchNo} for ${product.name}. Available: ${batch.quantityAvailable}, Requested: ${qty}`);
          }

          // Reduce batch quantity
          batch.quantityAvailable = Math.max(0, batch.quantityAvailable - qty);
          await batch.save({ session });

          // Record stock movement
          stockMovements.push({
            productId: productId,
            batchNo: batchNo,
            type: "sale",
            quantity: -qty,
            referenceType: "Invoice",
            referenceId: null,
            description: `Sale of ${qty} units from batch ${batchNo}`,
          });
        }
      } else {
        // No specific batch selected - use FIFO (oldest first)
        const batches = await StockBatch.find({
          productId: productId,
          quantityAvailable: { $gt: 0 }
        })
        .sort({ inwardDate: 1 }) // Oldest first
        .session(session);

        let qtyToReduce = orderedQty;
        for (const batch of batches) {
          if (qtyToReduce <= 0) break;

          const reduceQty = Math.min(batch.quantityAvailable, qtyToReduce);
          batch.quantityAvailable = Math.max(0, batch.quantityAvailable - reduceQty);
          await batch.save({ session });

          // Record stock movement
          stockMovements.push({
            productId: productId,
            batchNo: batch.batchNo,
            type: "sale",
            quantity: -reduceQty,
            referenceType: "Invoice",
            referenceId: null,
            description: `Sale of ${reduceQty} units from batch ${batch.batchNo} (FIFO)`,
          });

          qtyToReduce -= reduceQty;
        }

        if (qtyToReduce > 0) {
          throw new Error(`Insufficient stock for ${product.name}. Requested: ${orderedQty}, Available: ${orderedQty - qtyToReduce}`);
        }
      }

      // ─── Reduce overall product stock ─────────────────────────

      product.moq = Math.max(0, (product.moq || 0) - orderedQty);
      await product.save({ session });

      // ─── Prepare invoice item ──────────────────────────────────

      processedItems.push({
        productId: product._id,
        name: product.name,
        sku: product.sku,
        qty: orderedQty,
        price: price,
        total: round2(orderedQty * price),
        batchAllocations: batchEntries.length > 0 
          ? batchEntries.map(([batchNo, qty]) => ({ batchNo, qty }))
          : [],
      });
    }

    // ─── Create or Find Customer ────────────────────────────────

    let customer = null;
    if (customerPhone) {
      customer = await Customer.findOne({ phone: customerPhone }).session(session);
      if (!customer) {
        customer = new Customer({
          phone: customerPhone,
          name: customerName || "Unknown",
          type: customerType || "customer",
          shopName: shopName || "",
          address: customerAddress || "",
          city: customerCity || "",
          state: customerState || "",
        });
        await customer.save({ session });
      }
    }

    // ─── Create Invoice ──────────────────────────────────────────

    const invoiceNumber = await generateInvoiceNumber(session);

    const invoiceData = {
      invoiceNumber,
      billerName: billerName || "Unknown",
      items: processedItems,
      subtotal: round2(subtotal || 0),
      discount: round2(discount || 0),
      courierCharge: round2(courierCharge || 0),
      totalAmount: round2(totalAmount || 0),
      paymentMode: paymentMode || "Cash",
      status: status || "completed",
      customer: customer?._id || null,
      customerPhone: customerPhone || "",
      customerName: customerName || "",
      customerType: customerType || "",
      shopName: shopName || "",
      customerAddress: customerAddress || "",
      customerCity: customerCity || "",
      customerState: customerState || "",
      sameAsBuyer: sameAsBuyer !== undefined ? sameAsBuyer : true,
      shippingAddress: shippingAddress || {},
      salesperson: salesperson || "",
      referenceNo: referenceNo || "",
      invoiceDate: invoiceDate || new Date().toISOString(),
      orderType: orderType || "",
      showBatchSelector: showBatchSelector || false,
      priceType: priceType || "retailerPrice",
      batchSelections: batchSelections || {},  // Store batch selections
    };

    const invoice = new Invoice(invoiceData);
    await invoice.save({ session });

    // ─── Update stock movements with invoice reference ──────────

    for (const movement of stockMovements) {
      movement.referenceId = invoice._id;
      const stockMovement = new StockMovement(movement);
      await stockMovement.save({ session });
    }

    // ─── Commit Transaction ──────────────────────────────────────

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      invoice: invoice,
      message: "Invoice created successfully",
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("createInvoice error:", error);
    
    if (error.message.includes("Insufficient stock")) {
      return res.status(409).json({
        code: "INSUFFICIENT_STOCK",
        message: error.message,
      });
    }

    res.status(500).json({
      message: error.message || "Failed to create invoice",
    });
  }
};

// ─── Get All Invoices ─────────────────────────────────────────────────────────

exports.getInvoices = async (req, res) => {
  try {
    const { customer, from, to, status, search } = req.query;
    
    const query = {};
    if (customer) query.customer = customer;
    if (status) query.status = status;
    if (from || to) {
      query.invoiceDate = {};
      if (from) query.invoiceDate.$gte = new Date(from);
      if (to) query.invoiceDate.$lte = new Date(to);
    }
    
    let invoices = await Invoice.find(query)
      .populate("customer", "name phone")
      .sort({ createdAt: -1 });
    
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      invoices = invoices.filter(
        (inv) =>
          inv.invoiceNumber.toLowerCase().includes(q) ||
          (inv.customer?.name || "").toLowerCase().includes(q) ||
          (inv.customerPhone || "").includes(q)
      );
    }
    
    res.json(invoices);
  } catch (err) {
    console.error("getInvoices error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── Update Invoice Status ────────────────────────────────────────────────────

exports.updateInvoiceStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const invoice = await Invoice.findById(id);
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    invoice.status = status;
    await invoice.save();

    res.json({ 
      success: true, 
      invoice,
      message: "Invoice status updated successfully" 
    });
  } catch (err) {
    console.error("updateInvoiceStatus error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── Delete Invoice ──────────────────────────────────────────────────────────

exports.deleteInvoice = async (req, res) => {
  try {
    const { invoiceNumber } = req.params;

    const invoice = await Invoice.findOne({ invoiceNumber });
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    // Optional: Restore stock when invoice is deleted
    // This would require tracking which stock movements to reverse
    
    await invoice.deleteOne();

    res.json({ 
      success: true, 
      message: "Invoice deleted successfully" 
    });
  } catch (err) {
    console.error("deleteInvoice error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── Get Invoice by Number ────────────────────────────────────────────────────

exports.getInvoiceByNumber = async (req, res) => {
  try {
    const { invoiceNumber } = req.params;
    
    const invoice = await Invoice.findOne({ invoiceNumber })
      .populate("customer", "name phone address city state type shopName");
    
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }
    
    res.json(invoice);
  } catch (err) {
    console.error("getInvoiceByNumber error:", err);
    res.status(500).json({ message: err.message });
  }
};

//--------- old working code of invoice -----------------
// const Invoice = require("../models/Invoice/InvoiceModel");

// const getFinancialYear = () => {
//   const now = new Date();
//   const year = now.getFullYear();
//   const month = now.getMonth() + 1;
//   return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
// };


// const createInvoice = async (req, res) => {
//   try {
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
//       discount,           // 🆕
//       courierCharge,
//       salesperson,
//       referenceNo,
//       invoiceDate,
//       orderType,
//     } = req.body;

//     if (!customerPhone || !customerName || !items || !items.length || !totalAmount || !paymentMode) {
//       return res.status(400).json({ message: "Missing required invoice fields" });
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
//       discount: discount || 0,                   // ✅ include discount
//       courierCharge: courierCharge || 0,
//       salesperson: salesperson || "",
//       referenceNo: referenceNo || "",
//       invoiceDate: invoiceDate || new Date(),
//       orderType: orderType || '', 
//     });

//     res.status(201).json({
//       success: true,
//       invoice: {
//         id: invoice._id,
//         invoiceNumber: invoice.invoiceNumber,
//         date: invoice.invoiceDate,
//         totalAmount: invoice.totalAmount,
//       },
//     });
//   } catch (err) {
//     console.error("createInvoice error:", err);
//     res.status(500).json({ message: err.message });
//   }
// };

// // ✅ GET INVOICES (WITH STATUS FILTER) - FIXED
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

//     // ✅ Apply date filter
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
//     // If filter === "all", no date filter

//     // ✅ Apply biller name filter
//     if (billerName && billerName.trim() !== "") {
//       query.billerName = billerName;
//     }

//     // ✅ CRITICAL FIX: Apply status filter
//     if (status && status.trim() !== "") {
//       query.status = status; // ← Now properly filters
//     }

//     const invoices = await Invoice.find(query).sort({ createdAt: -1 });

//     res.json(invoices);
//   } catch (err) {
//     console.error("getInvoices error:", err);
//     res.status(500).json({ message: err.message });
//   }
// };

// // ✅ UPDATE STATUS
// const updateInvoiceStatus = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { status } = req.body;

//     // ✅ Validate status
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
//   deleteInvoice, // ← Don't forget to add to routes!
// };

