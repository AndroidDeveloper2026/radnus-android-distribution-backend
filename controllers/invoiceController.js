const mongoose = require("mongoose");
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

// Thrown when a requested batch no longer has enough stock at the moment of
// checkout (e.g. someone else sold from it first). Caught in createInvoice
// and surfaced as HTTP 409 — this is the error OrderSuccessPage.js's
// goToInvoice() already has a catch block for.
class InsufficientStockError extends Error {
  constructor(message) {
    super(message);
    this.code = "INSUFFICIENT_STOCK";
    this.statusCode = 409;
  }
}

// Core save routine — shared by the transactional path and the
// non-transactional fallback, mirroring runPurchaseSave in
// purchaseController.js so both write paths behave consistently.
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
    priceType,
  } = body;

  if (!customerPhone || !customerName || !items || !items.length || !totalAmount || !paymentMode) {
    const err = new Error("Missing required invoice fields");
    err.statusCode = 400;
    throw err;
  }

  // ── Batch stock consumption ────────────────────────────────────────────
  // For every item that carries batchAllocations (batch mode was on in the
  // cart), atomically decrement each named batch's quantityAvailable and
  // record a StockMovement. The update is conditional on quantityAvailable
  // being enough for the request, so two people checking out from the same
  // batch at once can never both succeed — the second one gets a clean
  // INSUFFICIENT_STOCK error instead of a negative quantityAvailable.
  const batchMovements = []; // { productId, batchNo, qty }
  const normalizedItems = [];
  const productQtyTotals = new Map(); // productId -> total qty sold, for Product.moq

  for (const item of items) {
    const productId = item.productId;
    const qty = Number(item.qty) || 0;
    productQtyTotals.set(productId, (productQtyTotals.get(productId) || 0) + qty);

    const rawAllocations = Array.isArray(item.batchAllocations) ? item.batchAllocations : [];
    const resolvedAllocations = [];

    for (const alloc of rawAllocations) {
      // Frontend sends { batchNumber, qty }; accept batchNo too for safety.
      const batchNo = alloc.batchNumber || alloc.batchNo;
      const allocQty = Number(alloc.qty) || 0;
      if (!batchNo || allocQty <= 0) continue;

      const updatedBatch = await StockBatch.findOneAndUpdate(
        { productId, batchNo, quantityAvailable: { $gte: allocQty } },
        { $inc: { quantityAvailable: -allocQty } },
        { session, new: true }
      );

      if (!updatedBatch) {
        // Either the batch doesn't exist, or it no longer has enough stock.
        const existing = await StockBatch.findOne({ productId, batchNo }).session(session || null);
        const available = existing ? existing.quantityAvailable : 0;
        throw new InsufficientStockError(
          `Only ${available} unit(s) left in batch ${batchNo} for "${item.name || "this item"}". Please review the cart.`
        );
      }

      resolvedAllocations.push({
        batchId: updatedBatch._id,
        batchNo: updatedBatch.batchNo,
        qty: allocQty,
        purchaseCost: updatedBatch.purchasePrice,
      });
      batchMovements.push({ productId, batchNo: updatedBatch.batchNo, quantity: -allocQty });
    }

    normalizedItems.push({
      productId,
      name: item.name,
      qty,
      price: item.price || 0,
      batchAllocations: resolvedAllocations,
    });
  }

  // ── Financial-year sequenced invoice number ────────────────────────────
  const financialYear = getFinancialYear();
  const lastInvoice = await Invoice.findOne({ financialYear }).session(session || null).sort({ sequence: -1 });
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
        items: normalizedItems,
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
        shippingAddress: sameAsBuyer ? {} : shippingAddress || {},
        subtotal: subtotal || totalAmount - (courierCharge || 0),
        discount: discount || 0,
        courierCharge: courierCharge || 0,
        salesperson: salesperson || "",
        referenceNo: referenceNo || "",
        invoiceDate: invoiceDate || new Date(),
        orderType: orderType || "",
        priceType: priceType || "retailerPrice",
      },
    ],
    { session }
  );
  const invoice = created[0];

  // ── Stock movement ledger + Product.moq (unchanged for non-batch items) ─
  if (batchMovements.length) {
    const movementDocs = batchMovements.map((m) => ({
      ...m,
      type: "sale",
      referenceId: invoice._id,
      referenceType: "Invoice",
    }));
    await StockMovement.insertMany(movementDocs, { session });
  }

  // Product.moq stays the single source of truth for "total stock across all
  // batches" regardless of whether batch mode was used for this sale — this
  // is what keeps the flat (non-batch) product cards elsewhere in the app
  // showing correct stock without any changes to those screens.
  for (const [productId, qty] of productQtyTotals.entries()) {
    if (!qty) continue;
    await Product.findByIdAndUpdate(productId, { $inc: { moq: -qty } }, { session });
  }

  return invoice;
}

const createInvoice = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    let result;
    try {
      await session.withTransaction(async () => {
        result = await runInvoiceSave(req.body, session);
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
        result = await runInvoiceSave(req.body, null);
      } else {
        throw txErr;
      }
    }

    res.status(201).json({
      success: true,
      invoice: {
        id: result._id,
        invoiceNumber: result.invoiceNumber,
        date: result.invoiceDate,
        totalAmount: result.totalAmount,
      },
    });
  } catch (err) {
    if (err.code === "INSUFFICIENT_STOCK") {
      return res.status(409).json({ code: "INSUFFICIENT_STOCK", message: err.message });
    }
    console.error("createInvoice error:", err);
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    session.endSession();
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
  deleteInvoice,
};



// ===== old code without batches 04.08.26 ===============


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