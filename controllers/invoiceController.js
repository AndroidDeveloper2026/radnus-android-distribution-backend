const mongoose = require("mongoose");
const Invoice = require("../models/Invoice/InvoiceModel");
const StockMovement = require("../models/Purchase/StockMovement");
const Product = require("../models/AdminModel/Product");
const {
  getBatchQueue,
  computeAllocation,
  consumeAllocations,
  InsufficientStockError,
} = require("../services/fifoAllocationService");

const getFinancialYear = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
};


// Core save routine — shared by the transactional path and the
// non-transactional fallback (standalone MongoDB without a replica set).
// Mirrors the pattern already used in purchaseController.runPurchaseSave.
async function runInvoiceSave(body, session) {
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
  } = body;

  if (!customerPhone || !customerName || !items || !items.length || !totalAmount || !paymentMode) {
    throw new Error("Missing required invoice fields");
  }

  // ─── FIFO allocation: figure out which batches each line item consumes,
  // then actually decrement those batches, before the invoice is written.
  // Any shortfall throws InsufficientStockError, which aborts the whole
  // transaction — nothing is partially saved.
  const itemsWithAllocations = [];
  const movementDocs = [];
  const productQtyTotals = new Map(); // productId (string) -> total qty sold, for the Product.moq update below

  for (const item of items) {
    if (!item.productId) throw new Error("Each invoice item must reference a product");
    const qty = Number(item.qty);
    if (!qty || qty <= 0) throw new Error(`Invalid quantity for ${item.name || item.productId}`);

    const productObjectId = mongoose.Types.ObjectId.isValid(item.productId)
      ? new mongoose.Types.ObjectId(item.productId)
      : item.productId;

    const allocations = await computeAllocation(productObjectId, qty, { session });
    await consumeAllocations(allocations, session);

    itemsWithAllocations.push({
      ...item,
      batchAllocations: allocations.map((a) => ({
        batchId: a.batchId,
        batchNo: a.batchNo,
        qty: a.qty,
        purchaseCost: a.purchaseCost,
      })),
    });

    for (const a of allocations) {
      movementDocs.push({
        productId: productObjectId,
        batchNo: a.batchNo,
        type: "sale",
        quantity: -a.qty, // negative = stock out
        referenceType: "Invoice",
      });
    }

    const key = String(productObjectId);
    productQtyTotals.set(key, (productQtyTotals.get(key) || 0) + qty);
  }

  // Keep Product.moq (the denormalized "current total stock" field used across
  // the UI — Products list, Order Cart, etc.) in sync with the batch-level
  // truth, atomically alongside the batch decrements above. This mirrors how
  // purchaseController.runPurchaseSave increments moq on the inbound side.
  for (const [productId, totalQty] of productQtyTotals.entries()) {
    await Product.findByIdAndUpdate(
      productId,
      { $inc: { moq: -totalQty } },
      { session, new: true }
    );
  }

  const financialYear = getFinancialYear();
  const lastInvoice = await Invoice.findOne({ financialYear }).sort({ sequence: -1 }).session(session);
  const nextSequence = lastInvoice ? lastInvoice.sequence + 1 : 1;
  const paddedSequence = String(nextSequence).padStart(3, "0");
  const invoiceNumber = `RC${financialYear}/${paddedSequence}`;

  const created = await Invoice.create(
    [
      {
        invoiceNumber,
        financialYear,
        sequence: nextSequence,
        billerName,
        items: itemsWithAllocations,
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
        orderType: orderType || "",
      },
    ],
    { session }
  );
  const invoice = created[0];

  const movementDocsWithRef = movementDocs.map((m) => ({ ...m, referenceId: invoice._id }));
  await StockMovement.insertMany(movementDocsWithRef, { session });

  return invoice;
}

// ─── Create Invoice (transactional, with fallback) ──────────────────────────
// Response shape is unchanged from before — existing frontend callers keep
// working exactly as they did. The only new behavior is that stock is now
// actually consumed batch-by-batch (FIFO) instead of not being touched at all.
const createInvoice = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    let invoice;
    try {
      await session.withTransaction(async () => {
        invoice = await runInvoiceSave(req.body, session);
      });
    } catch (txErr) {
      const msg = txErr?.message || "";
      const transactionsUnsupported =
        /Transaction numbers|IllegalOperation|replica set|not supported|Mongos/i.test(msg);

      if (transactionsUnsupported) {
        console.warn(
          "MongoDB transactions unsupported on this deployment — falling back to sequential (non-transactional) save:",
          msg
        );
        invoice = await runInvoiceSave(req.body, null);
      } else {
        throw txErr;
      }
    }

    res.status(201).json({
      success: true,
      invoice: {
        id: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        date: invoice.invoiceDate,
        totalAmount: invoice.totalAmount,
      },
    });
  } catch (err) {
    console.error("createInvoice error:", err);
    if (err instanceof InsufficientStockError || err.name === "InsufficientStockError") {
      return res.status(409).json({
        message: err.message,
        code: "INSUFFICIENT_STOCK",
        productId: err.productId,
      });
    }
    res.status(500).json({ message: err.message });
  } finally {
    session.endSession();
  }
};

// ─── FIFO Batch Queue (read-only, for the Billing UI cards) ─────────────────
// GET /api/invoices/batch-queue/:productId
const getProductBatchQueue = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }
    const queue = await getBatchQueue(new mongoose.Types.ObjectId(productId));
    res.json({ queue });
  } catch (err) {
    console.error("getProductBatchQueue error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── Preview Allocation (read-only, no writes) ──────────────────────────────
// POST /api/invoices/preview-allocation  { productId, qty }
// Powers the "Batch Allocation Panel" — shown live as the cashier types a
// quantity, before the invoice is actually created.
const previewAllocation = async (req, res) => {
  try {
    const { productId, qty } = req.body;
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }
    const allocations = await computeAllocation(new mongoose.Types.ObjectId(productId), qty);
    res.json({ allocations });
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return res.status(409).json({
        message: err.message,
        code: "INSUFFICIENT_STOCK",
        available: err.available,
      });
    }
    console.error("previewAllocation error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ✅ GET INVOICES (WITH STATUS FILTER) - FIXED
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

    // ✅ Apply date filter
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
    // If filter === "all", no date filter

    // ✅ Apply biller name filter
    if (billerName && billerName.trim() !== "") {
      query.billerName = billerName;
    }

    // ✅ CRITICAL FIX: Apply status filter
    if (status && status.trim() !== "") {
      query.status = status; // ← Now properly filters
    }

    const invoices = await Invoice.find(query).sort({ createdAt: -1 });

    res.json(invoices);
  } catch (err) {
    console.error("getInvoices error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ✅ UPDATE STATUS
const updateInvoiceStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // ✅ Validate status
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
  deleteInvoice, // ← Don't forget to add to routes!
  getProductBatchQueue, // NEW — FIFO batch queue for the Billing UI
  previewAllocation,    // NEW — live allocation preview before invoice creation
};

//===== Below code for ordertype updated and Before FIFO =============

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