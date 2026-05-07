// const SalesReturn    = require("../models/Returns/SalesReturnModel");
// const PurchaseReturn = require("../models/Returns/PurchaseReturnModel");

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
//   return {}; // "all" — no date filter
// };

// // ══════════════════════════════════════════════════════════════════
// //  SALES RETURNS
// // ══════════════════════════════════════════════════════════════════

// // POST /api/sales-returns
// const createSalesReturn = async (req, res) => {
//   try {
//     const { customerName, referenceInvoice, items, totalAmount, reason, billerName } = req.body;

//     if (!customerName || !items || !items.length || !totalAmount || !billerName) {
//       return res.status(400).json({ msg: "Missing required fields: customerName, items, totalAmount, billerName" });
//     }

//     // Auto-numbering per financial year
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
//     });

//     res.status(201).json(doc);
//   } catch (err) {
//     console.error("createSalesReturn error:", err);
//     res.status(500).json({ msg: err.message });
//   }
// };

// // GET /api/sales-returns?filter=all&billerName=xxx
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

// // PATCH /api/sales-returns/:id  — update status (Admin action)
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

// // DELETE /api/sales-returns/:id
// const deleteSalesReturn = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const doc = await SalesReturn.findByIdAndDelete(id);
//     if (!doc) return res.status(404).json({ msg: "Sales return not found" });
//     res.json({ msg: "Sales return deleted successfully" });
//   } catch (err) {
//     console.error("deleteSalesReturn error:", err);
//     res.status(500).json({ msg: err.message });
//   }
// };

// // ══════════════════════════════════════════════════════════════════
// //  PURCHASE RETURNS
// // ══════════════════════════════════════════════════════════════════

// // POST /api/purchase-returns
// const createPurchaseReturn = async (req, res) => {
//   try {
//     const { supplierName, referencePO, items, totalAmount, reason, billerName } = req.body;

//     if (!supplierName || !items || !items.length || !totalAmount || !billerName) {
//       return res.status(400).json({ msg: "Missing required fields: supplierName, items, totalAmount, billerName" });
//     }

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
//     });

//     res.status(201).json(doc);
//   } catch (err) {
//     console.error("createPurchaseReturn error:", err);
//     res.status(500).json({ msg: err.message });
//   }
// };

// // GET /api/purchase-returns?filter=all&billerName=xxx
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

// // PATCH /api/purchase-returns/:id
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

// // DELETE /api/purchase-returns/:id
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
//   // Sales
//   createSalesReturn,
//   getSalesReturns,
//   updateSalesReturnStatus,
//   deleteSalesReturn,
//   // Purchase
//   createPurchaseReturn,
//   getPurchaseReturns,
//   updatePurchaseReturnStatus,
//   deletePurchaseReturn,
// };

//-------------------------------------

const SalesReturn    = require("../models/Returns/SalesReturnModel");
const PurchaseReturn = require("../models/Returns/PurchaseReturnModel");
const Product        = require("../models/AdminModel/Product");

// ─── Shared helpers ────────────────────────────────────────────────────────────

const getFinancialYear = () => {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
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
  return {};
};

// ══════════════════════════════════════════════════════════════════
//  SALES RETURNS
//  Customer returns goods → stock comes BACK IN (+qty)
// ══════════════════════════════════════════════════════════════════

// POST /api/sales-returns
const createSalesReturn = async (req, res) => {
  try {
    const { customerName, referenceInvoice, items, totalAmount, reason, billerName } = req.body;

    if (!customerName || !items || !items.length || !totalAmount || !billerName) {
      return res.status(400).json({ msg: "Missing required fields: customerName, items, totalAmount, billerName" });
    }

    const financialYear  = getFinancialYear();
    const last           = await SalesReturn.findOne({ financialYear }).sort({ sequence: -1 });
    const nextSequence   = last ? last.sequence + 1 : 1;
    const returnNumber   = `SRN-${financialYear}/${String(nextSequence).padStart(3, "0")}`;

    const doc = await SalesReturn.create({
      returnNumber,
      financialYear,
      sequence: nextSequence,
      billerName,
      customerName,
      referenceInvoice: referenceInvoice || "",
      items,
      totalAmount,
      reason: reason || "",
    });

    // ✅ Customer returned goods → add qty BACK to stock
    const bulkStockOps = items
      .filter((item) => item.productId)
      .map((item) => ({
        updateOne: {
          filter: { _id: item.productId },
          update: { $inc: { moq: +item.qty } },  // +qty back into stock
        },
      }));
    if (bulkStockOps.length > 0) {
      await Product.bulkWrite(bulkStockOps);
    }

    res.status(201).json(doc);
  } catch (err) {
    console.error("createSalesReturn error:", err);
    res.status(500).json({ msg: err.message });
  }
};

// GET /api/sales-returns?filter=all&billerName=xxx
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

// PATCH /api/sales-returns/:id
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

// DELETE /api/sales-returns/:id
// Deleting a sales return means the return is cancelled → remove the stock that was added back
const deleteSalesReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await SalesReturn.findById(id);
    if (!doc) return res.status(404).json({ msg: "Sales return not found" });

    // Reverse the stock addition that happened when return was created
    const bulkStockOps = (doc.items || [])
      .filter((item) => item.productId)
      .map((item) => ({
        updateOne: {
          filter: { _id: item.productId },
          update: { $inc: { moq: -item.qty } }, // remove the returned qty from stock
        },
      }));
    if (bulkStockOps.length > 0) {
      await Product.bulkWrite(bulkStockOps);
    }

    await SalesReturn.findByIdAndDelete(id);
    res.json({ msg: "Sales return deleted successfully" });
  } catch (err) {
    console.error("deleteSalesReturn error:", err);
    res.status(500).json({ msg: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════
//  PURCHASE RETURNS
//  We return goods to supplier → stock goes OUT (-qty)
// ══════════════════════════════════════════════════════════════════

// POST /api/purchase-returns
const createPurchaseReturn = async (req, res) => {
  try {
    const { supplierName, referencePO, items, totalAmount, reason, billerName } = req.body;

    if (!supplierName || !items || !items.length || !totalAmount || !billerName) {
      return res.status(400).json({ msg: "Missing required fields: supplierName, items, totalAmount, billerName" });
    }

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
    });

    // ✅ We are sending goods BACK to supplier → deduct qty from stock
    const bulkStockOps = items
      .filter((item) => item.productId)
      .map((item) => ({
        updateOne: {
          filter: { _id: item.productId },
          update: { $inc: { moq: -item.qty } },  // -qty leaving our stock
        },
      }));
    if (bulkStockOps.length > 0) {
      await Product.bulkWrite(bulkStockOps);
    }

    res.status(201).json(doc);
  } catch (err) {
    console.error("createPurchaseReturn error:", err);
    res.status(500).json({ msg: err.message });
  }
};

// GET /api/purchase-returns?filter=all&billerName=xxx
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

// PATCH /api/purchase-returns/:id
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

// DELETE /api/purchase-returns/:id
// Deleting a purchase return means the return is cancelled → put the stock back
const deletePurchaseReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await PurchaseReturn.findById(id);
    if (!doc) return res.status(404).json({ msg: "Purchase return not found" });

    // Reverse the stock deduction that happened when return was created
    const bulkStockOps = (doc.items || [])
      .filter((item) => item.productId)
      .map((item) => ({
        updateOne: {
          filter: { _id: item.productId },
          update: { $inc: { moq: +item.qty } }, // put deducted qty back
        },
      }));
    if (bulkStockOps.length > 0) {
      await Product.bulkWrite(bulkStockOps);
    }

    await PurchaseReturn.findByIdAndDelete(id);
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
