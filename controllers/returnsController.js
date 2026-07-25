const mongoose        = require("mongoose");
const SalesReturn    = require("../models/Returns/SalesReturnModel");
const PurchaseReturn = require("../models/Returns/PurchaseReturnModel");
const Product        = require("../models/AdminModel/Product");
const Invoice        = require("../models/Invoice/InvoiceModel");
const StockMovement  = require("../models/Purchase/StockMovement");
const { restoreAllocations } = require("../services/fifoAllocationService");

// ─── Shared helpers ────────────────────────────────────────────────────────────

const getFinancialYear = () => {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1; // 1-based
  return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
};

const buildDateQuery = (filter) => {
  const now = new Date();
  if (filter === "today") {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end   = new Date(now); end.setHours(23, 59, 59, 999);
    return { createdAt: { $gte: start, $lte: end } };
  }
  if (filter === "week") {
    const start = new Date(now); start.setDate(now.getDate() - 7); start.setHours(0, 0, 0, 0);
    return { createdAt: { $gte: start, $lte: now } };
  }
  if (filter === "month") {
    const start = new Date(now); start.setMonth(now.getMonth() - 1); start.setHours(0, 0, 0, 0);
    return { createdAt: { $gte: start, $lte: now } };
  }
  return {}; // "all"
};

// ══════════════════════════════════════════════════════════════════
//  SALES RETURNS - FIXED: No longer mutates original invoice totals
// ══════════════════════════════════════════════════════════════════

// Batch-aware sales return: restores stock to the EXACT batch(es) each
// returned unit originally came from (per the referenced invoice's
// batchAllocations), instead of dumping everything back into Product.moq.
//
// Falls back to the old flat Product.moq increment ONLY when we can't find
// batch data for a line -- e.g. the return references an invoice created
// before this feature existed, or no referenceInvoice was given. This keeps
// old data working without forcing a backfill.
const createSalesReturn = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let doc;
    try {
      await session.withTransaction(async () => {
        doc = await runSalesReturnSave(req.body, session);
      });
    } catch (txErr) {
      const msg = txErr?.message || "";
      const transactionsUnsupported =
        /Transaction numbers|IllegalOperation|replica set|not supported|Mongos/i.test(msg);
      if (transactionsUnsupported) {
        console.warn(
          "MongoDB transactions unsupported on this deployment -- falling back to sequential (non-transactional) save:",
          msg
        );
        doc = await runSalesReturnSave(req.body, null);
      } else {
        throw txErr;
      }
    }
    res.status(201).json(doc);
  } catch (err) {
    console.error("createSalesReturn error:", err);
    res.status(500).json({ msg: err.message });
  } finally {
    session.endSession();
  }
};

async function runSalesReturnSave(body, session) {
  const { customerName, referenceInvoice, items, totalAmount, reason, billerName } = body;

  if (!customerName || !items || !items.length || !totalAmount || !billerName) {
    throw new Error("Missing required fields: customerName, items, totalAmount, billerName");
  }
  for (const item of items) {
    if (!item.productId) throw new Error("Each item must have a productId");
  }

  // Look up the original invoice (if referenced) to find each item's
  // batchAllocations so we know exactly where to restore stock.
  let originalInvoice = null;
  if (referenceInvoice) {
    originalInvoice = await Invoice.findOne({ invoiceNumber: referenceInvoice }).session(session);
  }

  const itemsWithAllocations = [];
  const movementDocs = [];
  const legacyProductIncrements = []; // fallback path, no batch data available

  for (const item of items) {
    const qty = Number(item.qty) || 0;
    const originalLine = originalInvoice?.items?.find(
      (li) => String(li.productId) === String(item.productId)
    );
    const hasBatchData = originalLine?.batchAllocations?.length > 0;

    if (hasBatchData) {
      // Distribute the returned qty across the same batches proportionally
      // to how the original sale drew from them, oldest batch first, capped
      // at each batch's original allocation so a partial return can't
      // over-restore beyond what was actually sold from that batch.
      let remaining = qty;
      const allocationsForReturn = [];
      for (const alloc of originalLine.batchAllocations) {
        if (remaining <= 0) break;
        const restoreQty = Math.min(alloc.qty, remaining);
        if (restoreQty <= 0) continue;
        allocationsForReturn.push({
          batchId: alloc.batchId,
          batchNo: alloc.batchNo,
          qty: restoreQty,
        });
        remaining -= restoreQty;
      }
      // Anything left over (e.g. returning more than was originally sold)
      // has no batch to go back to -- falls back to the product pool.
      if (remaining > 0) {
        legacyProductIncrements.push({ productId: item.productId, qty: remaining });
      }

      await restoreAllocations(allocationsForReturn, session);
      itemsWithAllocations.push({ ...item, batchAllocations: allocationsForReturn });

      for (const a of allocationsForReturn) {
        movementDocs.push({
          productId: item.productId,
          batchNo: a.batchNo,
          type: "sales_return",
          quantity: a.qty, // positive = stock back in
          referenceType: "SalesReturn",
        });
      }
    } else {
      // No batch trail available (pre-FIFO invoice, or no referenceInvoice) --
      // preserve the old behavior so existing data keeps working.
      legacyProductIncrements.push({ productId: item.productId, qty });
      itemsWithAllocations.push(item);
    }
  }

  if (legacyProductIncrements.length) {
    await Promise.all(
      legacyProductIncrements.map((u) =>
        Product.findByIdAndUpdate(
          u.productId,
          { $inc: { moq: u.qty } },
          { new: true, session }
        )
      )
    );
  }

  // NOTE: We do NOT modify the original invoice's totalAmount.
  // Sales returns are tracked separately to preserve accurate sales reporting.
  // The referenceInvoice is stored for reference/audit purposes only.

  const financialYear = getFinancialYear();
  const last = await SalesReturn.findOne({ financialYear }).sort({ sequence: -1 }).session(session);
  const nextSequence = last ? last.sequence + 1 : 1;
  const returnNumber = `SRN-${financialYear}/${String(nextSequence).padStart(3, "0")}`;

  const created = await SalesReturn.create(
    [
      {
        returnNumber,
        financialYear,
        sequence: nextSequence,
        billerName,
        customerName,
        referenceInvoice: referenceInvoice || "",
        items: itemsWithAllocations,
        totalAmount,
        reason: reason || "",
        status: "pending",
      },
    ],
    { session }
  );
  const doc = created[0];

  if (movementDocs.length) {
    const movementDocsWithRef = movementDocs.map((m) => ({ ...m, referenceId: doc._id }));
    await StockMovement.insertMany(movementDocsWithRef, { session });
  }

  return doc;
}

const getSalesReturns = async (req, res) => {
  try {
    const { filter = "all", billerName } = req.query;
    const query = { ...buildDateQuery(filter) };
    if (billerName && billerName.trim()) query.billerName = billerName.trim();
    const returns = await SalesReturn.find(query).sort({ createdAt: -1 });
    res.json(returns);
  } catch (err) {
    console.error("getSalesReturns error:", err);
    res.status(500).json({ msg: err.message });
  }
};

const updateSalesReturnStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ msg: "Invalid status" });
    }
    const doc = await SalesReturn.findByIdAndUpdate(id, { status }, { new: true });
    if (!doc) return res.status(404).json({ msg: "Sales return not found" });
    res.json(doc);
  } catch (err) {
    console.error("updateSalesReturnStatus error:", err);
    res.status(500).json({ msg: err.message });
  }
};

const deleteSalesReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await SalesReturn.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ msg: "Sales return not found" });
    
    // Optional: Revert stock adjustment if return is deleted
    // Only do this if the return was already approved/processed
    // For simplicity, we skip stock reversion here - implement based on your business logic
    
    res.json({ msg: "Sales return deleted successfully" });
  } catch (err) {
    console.error("deleteSalesReturn error:", err);
    res.status(500).json({ msg: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════
//  PURCHASE RETURNS - Stock decreases when goods are returned to supplier
// ══════════════════════════════════════════════════════════════════

const createPurchaseReturn = async (req, res) => {
  try {
    const { supplierName, referencePO, items, totalAmount, reason, billerName } = req.body;

    // Validation
    if (!supplierName || !items || !items.length || !totalAmount || !billerName) {
      return res.status(400).json({ 
        msg: "Missing required fields: supplierName, items, totalAmount, billerName" 
      });
    }

    // Ensure every item has a productId
    for (const item of items) {
      if (!item.productId) {
        return res.status(400).json({ msg: "Each item must have a productId" });
      }
    }

    // ✅ Decrease stock (moq) - goods leaving inventory back to supplier
    const stockUpdates = items.map(item => {
      return Product.findByIdAndUpdate(
        item.productId,
        { $inc: { moq: -item.qty } },
        { new: true }
      );
    });
    await Promise.all(stockUpdates);

    // Create the purchase return record
    const financialYear  = getFinancialYear();
    const last           = await PurchaseReturn.findOne({ financialYear }).sort({ sequence: -1 });
    const nextSequence   = last ? last.sequence + 1 : 1;
    const returnNumber   = `PRN-${financialYear}/${String(nextSequence).padStart(3, "0")}`;

    const doc = await PurchaseReturn.create({
      returnNumber,
      financialYear,
      sequence: nextSequence,
      billerName,
      supplierName,
      referencePO: referencePO || "",
      items,
      totalAmount,
      reason: reason || "",
      status: "pending"
    });

    res.status(201).json(doc);
  } catch (err) {
    console.error("createPurchaseReturn error:", err);
    res.status(500).json({ msg: err.message });
  }
};

const getPurchaseReturns = async (req, res) => {
  try {
    const { filter = "all", billerName } = req.query;
    const query = { ...buildDateQuery(filter) };
    if (billerName && billerName.trim()) query.billerName = billerName.trim();
    const returns = await PurchaseReturn.find(query).sort({ createdAt: -1 });
    res.json(returns);
  } catch (err) {
    console.error("getPurchaseReturns error:", err);
    res.status(500).json({ msg: err.message });
  }
};

const updatePurchaseReturnStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ msg: "Invalid status" });
    }
    const doc = await PurchaseReturn.findByIdAndUpdate(id, { status }, { new: true });
    if (!doc) return res.status(404).json({ msg: "Purchase return not found" });
    res.json(doc);
  } catch (err) {
    console.error("updatePurchaseReturnStatus error:", err);
    res.status(500).json({ msg: err.message });
  }
};

const deletePurchaseReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await PurchaseReturn.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ msg: "Purchase return not found" });
    res.json({ msg: "Purchase return deleted successfully" });
  } catch (err) {
    console.error("deletePurchaseReturn error:", err);
    res.status(500).json({ msg: err.message });
  }
};

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  createSalesReturn,
  getSalesReturns,
  updateSalesReturnStatus,
  deleteSalesReturn,
  createPurchaseReturn,
  getPurchaseReturns,
  updatePurchaseReturnStatus,
  deletePurchaseReturn,
};

//+++++++++++++++++++++++++++++++++++++++
// const SalesReturn    = require("../models/Returns/SalesReturnModel");
// const PurchaseReturn = require("../models/Returns/PurchaseReturnModel");
// const Product        = require("../models/AdminModel/Product");

// // ─── Shared helpers ────────────────────────────────────────────────────────────

// const getFinancialYear = () => {
//   const now   = new Date();
//   const year  = now.getFullYear();
//   const month = now.getMonth() + 1; // 1-based
//   return month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
// };

// const buildDateQuery = (filter) => {
//   const now = new Date();
//   if (filter === "today") {
//     const start = new Date(now); start.setHours(0, 0, 0, 0);
//     const end   = new Date(now); end.setHours(23, 59, 59, 999);
//     return { createdAt: { $gte: start, $lte: end } };
//   }
//   if (filter === "week") {
//     const start = new Date(now); start.setDate(now.getDate() - 7); start.setHours(0, 0, 0, 0);
//     return { createdAt: { $gte: start, $lte: now } };
//   }
//   if (filter === "month") {
//     const start = new Date(now); start.setMonth(now.getMonth() - 1); start.setHours(0, 0, 0, 0);
//     return { createdAt: { $gte: start, $lte: now } };
//   }
//   return {}; // "all"
// };

// // ══════════════════════════════════════════════════════════════════
// //  SALES RETURNS - FIXED: No longer mutates original invoice totals
// // ══════════════════════════════════════════════════════════════════

// const createSalesReturn = async (req, res) => {
//   try {
//     const { customerName, referenceInvoice, items, totalAmount, reason, billerName } = req.body;

//     // Validation
//     if (!customerName || !items || !items.length || !totalAmount || !billerName) {
//       return res.status(400).json({ 
//         msg: "Missing required fields: customerName, items, totalAmount, billerName" 
//       });
//     }

//     // Ensure every item has a productId
//     for (const item of items) {
//       if (!item.productId) {
//         return res.status(400).json({ msg: "Each item must have a productId" });
//       }
//     }

//     // ✅ Increase stock (moq) for each returned product
//     const stockUpdates = items.map(item => {
//       return Product.findByIdAndUpdate(
//         item.productId,
//         { $inc: { moq: item.qty } },
//         { new: true }
//       );
//     });
//     await Promise.all(stockUpdates);

//     // ⚠️ NOTE: We do NOT modify the original invoice's totalAmount.
//     // Sales returns are tracked separately to preserve accurate sales reporting.
//     // The referenceInvoice is stored for reference/audit purposes only.

//     // Create the sales return record
//     const financialYear  = getFinancialYear();
//     const last           = await SalesReturn.findOne({ financialYear }).sort({ sequence: -1 });
//     const nextSequence   = last ? last.sequence + 1 : 1;
//     const returnNumber   = `SRN-${financialYear}/${String(nextSequence).padStart(3, "0")}`;

//     const doc = await SalesReturn.create({
//       returnNumber,
//       financialYear,
//       sequence: nextSequence,
//       billerName,
//       customerName,
//       referenceInvoice: referenceInvoice || "",
//       items,
//       totalAmount,
//       reason: reason || "",
//       status: "pending"
//     });

//     res.status(201).json(doc);
//   } catch (err) {
//     console.error("createSalesReturn error:", err);
//     res.status(500).json({ msg: err.message });
//   }
// };

// const getSalesReturns = async (req, res) => {
//   try {
//     const { filter = "all", billerName } = req.query;
//     const query = { ...buildDateQuery(filter) };
//     if (billerName && billerName.trim()) query.billerName = billerName.trim();
//     const returns = await SalesReturn.find(query).sort({ createdAt: -1 });
//     res.json(returns);
//   } catch (err) {
//     console.error("getSalesReturns error:", err);
//     res.status(500).json({ msg: err.message });
//   }
// };

// const updateSalesReturnStatus = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { status } = req.body;
//     if (!["pending", "approved", "rejected"].includes(status)) {
//       return res.status(400).json({ msg: "Invalid status" });
//     }
//     const doc = await SalesReturn.findByIdAndUpdate(id, { status }, { new: true });
//     if (!doc) return res.status(404).json({ msg: "Sales return not found" });
//     res.json(doc);
//   } catch (err) {
//     console.error("updateSalesReturnStatus error:", err);
//     res.status(500).json({ msg: err.message });
//   }
// };

// const deleteSalesReturn = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const doc = await SalesReturn.findByIdAndDelete(id);
//     if (!doc) return res.status(404).json({ msg: "Sales return not found" });
    
//     // Optional: Revert stock adjustment if return is deleted
//     // Only do this if the return was already approved/processed
//     // For simplicity, we skip stock reversion here - implement based on your business logic
    
//     res.json({ msg: "Sales return deleted successfully" });
//   } catch (err) {
//     console.error("deleteSalesReturn error:", err);
//     res.status(500).json({ msg: err.message });
//   }
// };

// // ══════════════════════════════════════════════════════════════════
// //  PURCHASE RETURNS - Stock decreases when goods are returned to supplier
// // ══════════════════════════════════════════════════════════════════

// const createPurchaseReturn = async (req, res) => {
//   try {
//     const { supplierName, referencePO, items, totalAmount, reason, billerName } = req.body;

//     // Validation
//     if (!supplierName || !items || !items.length || !totalAmount || !billerName) {
//       return res.status(400).json({ 
//         msg: "Missing required fields: supplierName, items, totalAmount, billerName" 
//       });
//     }

//     // Ensure every item has a productId
//     for (const item of items) {
//       if (!item.productId) {
//         return res.status(400).json({ msg: "Each item must have a productId" });
//       }
//     }

//     // ✅ Decrease stock (moq) - goods leaving inventory back to supplier
//     const stockUpdates = items.map(item => {
//       return Product.findByIdAndUpdate(
//         item.productId,
//         { $inc: { moq: -item.qty } },
//         { new: true }
//       );
//     });
//     await Promise.all(stockUpdates);

//     // Create the purchase return record
//     const financialYear  = getFinancialYear();
//     const last           = await PurchaseReturn.findOne({ financialYear }).sort({ sequence: -1 });
//     const nextSequence   = last ? last.sequence + 1 : 1;
//     const returnNumber   = `PRN-${financialYear}/${String(nextSequence).padStart(3, "0")}`;

//     const doc = await PurchaseReturn.create({
//       returnNumber,
//       financialYear,
//       sequence: nextSequence,
//       billerName,
//       supplierName,
//       referencePO: referencePO || "",
//       items,
//       totalAmount,
//       reason: reason || "",
//       status: "pending"
//     });

//     res.status(201).json(doc);
//   } catch (err) {
//     console.error("createPurchaseReturn error:", err);
//     res.status(500).json({ msg: err.message });
//   }
// };

// const getPurchaseReturns = async (req, res) => {
//   try {
//     const { filter = "all", billerName } = req.query;
//     const query = { ...buildDateQuery(filter) };
//     if (billerName && billerName.trim()) query.billerName = billerName.trim();
//     const returns = await PurchaseReturn.find(query).sort({ createdAt: -1 });
//     res.json(returns);
//   } catch (err) {
//     console.error("getPurchaseReturns error:", err);
//     res.status(500).json({ msg: err.message });
//   }
// };

// const updatePurchaseReturnStatus = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { status } = req.body;
//     if (!["pending", "approved", "rejected"].includes(status)) {
//       return res.status(400).json({ msg: "Invalid status" });
//     }
//     const doc = await PurchaseReturn.findByIdAndUpdate(id, { status }, { new: true });
//     if (!doc) return res.status(404).json({ msg: "Purchase return not found" });
//     res.json(doc);
//   } catch (err) {
//     console.error("updatePurchaseReturnStatus error:", err);
//     res.status(500).json({ msg: err.message });
//   }
// };

// const deletePurchaseReturn = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const doc = await PurchaseReturn.findByIdAndDelete(id);
//     if (!doc) return res.status(404).json({ msg: "Purchase return not found" });
//     res.json({ msg: "Purchase return deleted successfully" });
//   } catch (err) {
//     console.error("deletePurchaseReturn error:", err);
//     res.status(500).json({ msg: err.message });
//   }
// };

// // ─── Exports ───────────────────────────────────────────────────────────────────

// module.exports = {
//   createSalesReturn,
//   getSalesReturns,
//   updateSalesReturnStatus,
//   deleteSalesReturn,
//   createPurchaseReturn,
//   getPurchaseReturns,
//   updatePurchaseReturnStatus,
//   deletePurchaseReturn,
// };