
// controllers/purchaseController.js
const mongoose = require("mongoose");

const PurchaseEntry = require("../models/Purchase/PurchaseEntry");
const StockBatch = require("../models/Purchase/StockBatch");
const StockMovement = require("../models/Purchase/StockMovement");
const Supplier = require("../models/Purchase/Supplier");
const Product = require("../models/AdminModel/Product");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const numOrUndefined = (v) => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
};

function getFinancialYear(date) {
  const d = date ? new Date(date) : new Date();
  const y = d.getFullYear();
  const fyStart = d.getMonth() >= 3 ? y : y - 1;
  return `${fyStart}-${fyStart + 1}`;
}

async function generatePurchaseNumber(session) {
  const docs = await PurchaseEntry.find({}, { purchaseNumber: 1 })
    .session(session || null)
    .lean();

  let maxSeq = 0;
  for (const d of docs) {
    const match = d.purchaseNumber?.match(/(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  return `PUR${String(maxSeq + 1).padStart(5, "0")}`;
}

async function generateInvoiceNumber(session, date) {
  const fy = getFinancialYear(date);
  const prefix = `RC${fy}/PUC/`;
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const regex = new RegExp(`^${escapedPrefix}(\\d+)$`);

  const docs = await PurchaseEntry.find({ invoiceNumber: regex }, { invoiceNumber: 1 })
    .session(session || null)
    .lean();

  let nextSeq = 1;
  let maxSeq = 0;
  for (const d of docs) {
    const match = d.invoiceNumber?.match(/(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  if (maxSeq > 0) nextSeq = maxSeq + 1;
  return `${prefix}${String(nextSeq).padStart(3, "0")}`;
}

function formatDateStamp(date) {
  const d = date ? new Date(date) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function formatBatchNo(dateStamp, seq) {
  return `B${dateStamp}-${String(seq).padStart(3, "0")}`;
}

async function getNextBatchSeq(dateStamp, session) {
  const prefix = `B${dateStamp}-`;
  const regex = new RegExp(`^${prefix}(\\d+)$`);

  const docs = await StockBatch.find({ batchNo: regex }, { batchNo: 1 })
    .session(session || null)
    .lean();

  let nextSeq = 1;
  let maxSeq = 0;
  for (const d of docs) {
    const match = d.batchNo?.match(/-(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  if (maxSeq > 0) nextSeq = maxSeq + 1;
  return nextSeq;
}

function computeAverageCost(product, qty, purchasePrice) {
  const existingQty = Number(product.moq) || 0;
  const existingAvg =
    Number(product.averageCost) > 0
      ? Number(product.averageCost)
      : Number(product.itemCost) || Number(product.lastPurchasePrice) || purchasePrice;

  const newQty = existingQty + qty;
  if (newQty <= 0) return purchasePrice;
  return round2((existingQty * existingAvg + qty * purchasePrice) / newQty);
}

// ─── Core Save Routine ──────────────────────────────────────────────────────

async function runPurchaseSave(body, createdBy, session) {
  const {
    supplier,
    invoiceDate,
    paymentType,
    remarks,
    products = [],
    discount = 0,
    paidAmount = 0,
  } = body;

  if (!supplier) throw new Error("Supplier is required");
  if (!invoiceDate) throw new Error("Invoice date is required");
  if (!Array.isArray(products) || !products.length) {
    throw new Error("At least one product line is required");
  }

  const supplierDoc = await Supplier.findById(supplier).session(session || null);
  if (!supplierDoc) throw new Error("Supplier not found");

  let subtotal = 0;
  let gstAmount = 0;
  const lineItems = [];
  const stockBatchDocs = [];
  const movementDocs = [];
  const productUpdates = [];

  const dateStamp = formatDateStamp(invoiceDate);
  let batchSeq = await getNextBatchSeq(dateStamp, session);

  for (const p of products) {
    if (!p.productId) throw new Error("Each item must reference a product");

    const qty = Number(p.quantity);
    const price = Number(p.purchasePrice);
    if (!qty || qty <= 0) throw new Error(`Invalid quantity for ${p.name || p.sku || "item"}`);
    if (Number.isNaN(price) || price < 0) {
      throw new Error(`Invalid purchase price for ${p.name || p.sku || "item"}`);
    }

    const productDoc = await Product.findById(p.productId).session(session || null);
    if (!productDoc) throw new Error(`Product not found: ${p.name || p.sku || p.productId}`);

    const lineTotal = round2(qty * price);
    const lineGst = round2((lineTotal * (Number(p.gst) || 0)) / 100);
    subtotal += lineTotal;
    gstAmount += lineGst;

    const batchNo = formatBatchNo(dateStamp, batchSeq);
    batchSeq += 1;

    lineItems.push({
      productId: productDoc._id,
      sku: productDoc.sku,
      name: productDoc.name,
      quantity: qty,
      purchasePrice: price,
      mrp: Number(p.mrp) || productDoc.mrp || 0,
      gst: Number(p.gst) || 0,
      rackNo: p.rackNo || "",
      batchNo,
      total: lineTotal,
      itemCost: numOrUndefined(p.itemCost),
      distributorPrice: numOrUndefined(p.distributorPrice),
      retailerPrice: numOrUndefined(p.retailerPrice),
      walkinPrice: numOrUndefined(p.walkinPrice),
    });

    stockBatchDocs.push({
      productId: productDoc._id,
      batchNo,
      inwardDate: invoiceDate,
      purchasePrice: price,
      quantityPurchased: qty,
      quantityAvailable: qty,
      rackNo: p.rackNo || "",
      expiryDate: p.expiryDate || null,
      retailerPrice: numOrUndefined(p.retailerPrice),
      distributorPrice: numOrUndefined(p.distributorPrice),
      walkinPrice: numOrUndefined(p.walkinPrice),
      mrp: Number(p.mrp) || productDoc.mrp || 0,
    });

    productUpdates.push({
      productId: productDoc._id,
      qty,
      price,
      newAverageCost: computeAverageCost(productDoc, qty, price),
      itemCost: numOrUndefined(p.itemCost),
      distributorPrice: numOrUndefined(p.distributorPrice),
      retailerPrice: numOrUndefined(p.retailerPrice),
      walkinPrice: numOrUndefined(p.walkinPrice),
    });

    movementDocs.push({
      productId: productDoc._id,
      batchNo,
      type: "purchase",
      quantity: qty,
      referenceType: "PurchaseEntry",
    });
  }

  const grandTotal = round2(subtotal - (Number(discount) || 0) + gstAmount);
  const paid = round2(Number(paidAmount) || 0);
  const due = round2(grandTotal - paid);
  const paymentStatus = due <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";

  const purchaseNumber = await generatePurchaseNumber(session);
  const invoiceNumber = await generateInvoiceNumber(session, invoiceDate);

  const created = await PurchaseEntry.create(
    [
      {
        purchaseNumber,
        supplier,
        invoiceNumber,
        invoiceDate,
        paymentType: paymentType || "Credit",
        remarks: remarks || "",
        products: lineItems,
        subtotal: round2(subtotal),
        discount: round2(Number(discount) || 0),
        gstAmount: round2(gstAmount),
        grandTotal,
        paidAmount: paid,
        dueAmount: due,
        paymentStatus,
        createdBy: createdBy || "",
      },
    ],
    { session }
  );
  const purchaseEntry = created[0];

  const batchDocsWithRef = stockBatchDocs.map((b) => ({ ...b, purchaseEntryId: purchaseEntry._id }));
  await StockBatch.insertMany(batchDocsWithRef, { session });

  const movementDocsWithRef = movementDocs.map((m) => ({ ...m, referenceId: purchaseEntry._id }));
  await StockMovement.insertMany(movementDocsWithRef, { session });

  for (const u of productUpdates) {
    const setFields = { lastPurchasePrice: u.price, averageCost: u.newAverageCost };
    if (u.itemCost !== undefined) setFields.itemCost = u.itemCost;
    if (u.distributorPrice !== undefined) setFields.distributorPrice = u.distributorPrice;
    if (u.retailerPrice !== undefined) setFields.retailerPrice = u.retailerPrice;
    if (u.walkinPrice !== undefined) setFields.walkinPrice = u.walkinPrice;

    await Product.findByIdAndUpdate(
      u.productId,
      { $inc: { moq: u.qty }, $set: setFields },
      { session, new: true }
    );
  }

  return purchaseEntry;
}

// ─── Create Purchase Entry ───────────────────────────────────────────────────

exports.createPurchaseEntry = async (req, res) => {
  const createdBy = req.user?.name || req.user?.email || req.user?.id || "";
  const session = await mongoose.startSession();

  try {
    let result;
    try {
      await session.withTransaction(async () => {
        result = await runPurchaseSave(req.body, createdBy, session);
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
        result = await runPurchaseSave(req.body, createdBy, null);
      } else {
        throw txErr;
      }
    }

    res.status(201).json(result);
  } catch (err) {
    console.error("createPurchaseEntry error:", err);
    res.status(400).json({ msg: err.message || "Failed to save purchase entry" });
  } finally {
    session.endSession();
  }
};

// ─── Purchase History ────────────────────────────────────────────────────────

exports.getPurchaseEntries = async (req, res) => {
  try {
    const { supplier, invoiceNumber, from, to, paymentStatus, search } = req.query;
    const query = {};

    if (supplier) query.supplier = supplier;
    if (invoiceNumber) query.invoiceNumber = { $regex: invoiceNumber, $options: "i" };
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (from || to) {
      query.invoiceDate = {};
      if (from) query.invoiceDate.$gte = new Date(from);
      if (to) query.invoiceDate.$lte = new Date(to);
    }

    let entries = await PurchaseEntry.find(query)
      .populate("supplier", "name mobile gstNo")
      .sort({ createdAt: -1 });

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      entries = entries.filter(
        (e) =>
          e.purchaseNumber.toLowerCase().includes(q) ||
          e.invoiceNumber.toLowerCase().includes(q) ||
          (e.supplier?.name || "").toLowerCase().includes(q)
      );
    }

    res.json(entries);
  } catch (err) {
    console.error("getPurchaseEntries error:", err);
    res.status(500).json({ msg: err.message });
  }
};

// ─── Get Single Purchase Entry ──────────────────────────────────────────────

exports.getPurchaseEntryById = async (req, res) => {
  try {
    const entry = await PurchaseEntry.findById(req.params.id).populate(
      "supplier",
      "name mobile gstNo address"
    );
    if (!entry) return res.status(404).json({ msg: "Purchase entry not found" });
    res.json(entry);
  } catch (err) {
    console.error("getPurchaseEntryById error:", err);
    res.status(500).json({ msg: err.message });
  }
};

// ─── Update Purchase Entry ────────────────────────────────────────────────────

exports.updatePurchaseEntry = async (req, res) => {
  try {
    const { paymentType, remarks, paidAmount } = req.body;
    const entry = await PurchaseEntry.findById(req.params.id);
    if (!entry) return res.status(404).json({ msg: "Purchase entry not found" });

    if (paymentType !== undefined) entry.paymentType = paymentType;
    if (remarks !== undefined) entry.remarks = remarks;
    if (paidAmount !== undefined) {
      const paid = round2(Number(paidAmount) || 0);
      entry.paidAmount = paid;
      entry.dueAmount = round2(entry.grandTotal - paid);
      entry.paymentStatus = entry.dueAmount <= 0 ? "paid" : paid > 0 ? "partial" : "unpaid";
    }

    await entry.save();
    res.json(entry);
  } catch (err) {
    console.error("updatePurchaseEntry error:", err);
    res.status(400).json({ msg: err.message });
  }
};

// ─── Stock Aging ─────────────────────────────────────────────────────────────

exports.getStockAging = async (req, res) => {
  try {
    const batches = await StockBatch.find({ quantityAvailable: { $gt: 0 } })
      .populate("productId", "name sku")
      .sort({ inwardDate: 1 });

    const now = Date.now();
    const buckets = { "0-30": [], "31-60": [], "61-90": [], "91-180": [], "180+": [] };

    batches.forEach((b) => {
      const days = Math.floor((now - new Date(b.inwardDate).getTime()) / (1000 * 60 * 60 * 24));
      const row = {
        productId: b.productId?._id,
        productName: b.productId?.name || "—",
        sku: b.productId?.sku || "—",
        batchNo: b.batchNo,
        inwardDate: b.inwardDate,
        quantityAvailable: b.quantityAvailable,
        daysInStock: days,
      };
      if (days <= 30) buckets["0-30"].push(row);
      else if (days <= 60) buckets["31-60"].push(row);
      else if (days <= 90) buckets["61-90"].push(row);
      else if (days <= 180) buckets["91-180"].push(row);
      else buckets["180+"].push(row);
    });

    res.json(buckets);
  } catch (err) {
    console.error("getStockAging error:", err);
    res.status(500).json({ msg: err.message });
  }
};

// ─── Non-Moving Stock ────────────────────────────────────────────────────────

exports.getNonMovingStock = async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 60;

    const batches = await StockBatch.find({ quantityAvailable: { $gt: 0 } })
      .populate("productId", "name sku")
      .populate({
        path: "purchaseEntryId",
        select: "supplier",
        populate: { path: "supplier", select: "name" },
      })
      .sort({ inwardDate: 1 });

    const productIds = [...new Set(batches.map((b) => String(b.productId?._id)).filter(Boolean))];

    const lastSales = await StockMovement.aggregate([
      {
        $match: {
          productId: { $in: productIds.map((id) => new mongoose.Types.ObjectId(id)) },
          type: "sale",
        },
      },
      { $group: { _id: "$productId", lastSaleDate: { $max: "$createdAt" } } },
    ]);
    const lastSaleMap = {};
    lastSales.forEach((s) => {
      lastSaleMap[String(s._id)] = s.lastSaleDate;
    });

    const now = Date.now();
    const result = batches
      .map((b) => {
        const lastSaleDate = lastSaleMap[String(b.productId?._id)] || null;
        const referenceDate = lastSaleDate || b.inwardDate;
        const daysInStock = Math.floor((now - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24));
        return {
          productId: b.productId?._id,
          productName: b.productId?.name || "—",
          sku: b.productId?.sku || "—",
          batchNo: b.batchNo,
          supplierName: b.purchaseEntryId?.supplier?.name || "—",
          inwardDate: b.inwardDate,
          lastSaleDate,
          daysInStock,
          quantityAvailable: b.quantityAvailable,
        };
      })
      .filter((r) => r.daysInStock >= days);

    res.json(result);
  } catch (err) {
    console.error("getNonMovingStock error:", err);
    res.status(500).json({ msg: err.message });
  }
};

// ─── Price History ───────────────────────────────────────────────────────────

exports.getPriceHistory = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!productId) return res.status(400).json({ msg: "productId is required" });
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ msg: `"${productId}" is not a valid product id` });
    }

    const productObjectId = new mongoose.Types.ObjectId(productId);

    const entries = await PurchaseEntry.find({ "products.productId": productObjectId })
      .populate("supplier", "name")
      .sort({ invoiceDate: -1, createdAt: -1 });

    const history = entries.flatMap((entry) =>
      entry.products
        .filter((p) => String(p.productId) === String(productId))
        .map((p) => ({
          purchaseNumber: entry.purchaseNumber,
          invoiceNumber: entry.invoiceNumber,
          invoiceDate: entry.invoiceDate,
          supplierName: entry.supplier?.name || "—",
          quantity: p.quantity,
          purchasePrice: p.purchasePrice,
          mrp: p.mrp,
          gst: p.gst,
          itemCost: p.itemCost ?? null,
          distributorPrice: p.distributorPrice ?? null,
          retailerPrice: p.retailerPrice ?? null,
          walkinPrice: p.walkinPrice ?? null,
          batchNo: p.batchNo,
        }))
    );

    res.json(history);
  } catch (err) {
    console.error("getPriceHistory error:", err);
    res.status(500).json({ msg: err.message });
  }
};

// ─── Product Price History ───────────────────────────────────────────────────

exports.getProductPriceHistory = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ msg: "Invalid product ID" });
    }

    const productObjectId = new mongoose.Types.ObjectId(productId);

    const product = await Product.findById(productObjectId);
    if (!product) {
      return res.status(404).json({ msg: "Product not found" });
    }

    const purchases = await PurchaseEntry.aggregate([
      { $match: { "products.productId": productObjectId } },
      { $unwind: "$products" },
      { $match: { "products.productId": productObjectId } },
      {
        $lookup: {
          from: "suppliers",
          localField: "supplier",
          foreignField: "_id",
          as: "supplierInfo"
        }
      },
      { $unwind: { path: "$supplierInfo", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          purchaseNumber: 1,
          invoiceNumber: 1,
          invoiceDate: 1,
          purchaseDate: "$invoiceDate",
          supplierName: { $ifNull: ["$supplierInfo.name", "—"] },
          supplierId: "$supplier",
          quantity: "$products.quantity",
          purchasePrice: "$products.purchasePrice",
          mrp: "$products.mrp",
          gst: "$products.gst",
          rackNo: "$products.rackNo",
          batchNo: "$products.batchNo",
          total: "$products.total",
          itemCost: "$products.itemCost",
          distributorPrice: "$products.distributorPrice",
          retailerPrice: "$products.retailerPrice",
          walkinPrice: "$products.walkinPrice",
          remarks: 1,
          createdBy: 1,
          createdAt: 1,
          paymentType: 1,
          paidAmount: 1,
          dueAmount: 1,
          paymentStatus: 1
        }
      },
      { $sort: { purchaseDate: -1, createdAt: -1 } }
    ]);

    const history = purchases.map(p => ({
      ...p,
      purchaseId: p._id
    }));

    const prices = history.map(h => h.purchasePrice).filter(p => p !== null && p !== undefined);

    const summary = {
      currentPurchasePrice: product.lastPurchasePrice || 0,
      lowestPrice: prices.length > 0 ? Math.min(...prices) : 0,
      highestPrice: prices.length > 0 ? Math.max(...prices) : 0,
      averagePrice: prices.length > 0 
        ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 
        : 0,
      totalPurchases: history.length,
      lastPurchaseDate: history.length > 0 ? history[0].purchaseDate : null
    };

    const productInfo = {
      _id: product._id,
      name: product.name,
      sku: product.sku,
      image: product.image || null,
      category: product.category || "—",
      brand: product.brand || "—",
      unit: product.unit || "Pcs",
      currentPurchasePrice: product.lastPurchasePrice || 0,
      currentMRP: product.mrp || 0,
      currentDistributorPrice: product.distributorPrice || 0,
      currentRetailPrice: product.retailerPrice || 0,
      currentWalkinPrice: product.walkinPrice || 0
    };

    res.json({
      product: productInfo,
      summary: summary,
      history: history
    });

  } catch (err) {
    console.error("getProductPriceHistory error:", err);
    res.status(500).json({ msg: err.message || "Failed to fetch product price history" });
  }
};

// ─── Product Batches for OrderCartPage ──────────────────────────────────────

exports.getProductBatches = async (req, res) => {
  try {
    const { productIds, limit = 0 } = req.body;
    
    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ msg: "Product IDs are required" });
    }

    const validIds = productIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
      return res.json({});
    }

    const objectIds = validIds.map(id => new mongoose.Types.ObjectId(id));

    const result = await PurchaseEntry.aggregate([
      { $unwind: "$products" },
      { $match: { "products.productId": { $in: objectIds } } },
      {
        $group: {
          _id: "$products.productId",
          batches: {
            $push: {
              batchNo: "$products.batchNo",
              purchasePrice: "$products.purchasePrice",
              quantity: "$products.quantity",
              mrp: "$products.mrp",
              gst: "$products.gst",
              total: "$products.total",
              itemCost: "$products.itemCost",
              distributorPrice: "$products.distributorPrice",
              retailerPrice: "$products.retailerPrice",
              walkinPrice: "$products.walkinPrice",
              invoiceDate: "$invoiceDate",
              invoiceNumber: "$invoiceNumber",
              purchaseNumber: "$purchaseNumber"
            }
          }
        }
      },
      {
        $addFields: {
          batches: {
            $sortArray: { 
              input: "$batches", 
              sortBy: { invoiceDate: -1 } 
            }
          }
        }
      },
      ...(limit > 0 ? [{
        $addFields: {
          batches: { $slice: ["$batches", limit] }
        }
      }] : [])
    ]);

    const formattedResult = {};
    result.forEach(item => {
      formattedResult[item._id.toString()] = item.batches;
    });

    validIds.forEach(id => {
      if (!formattedResult[id]) {
        formattedResult[id] = [];
      }
    });

    res.json(formattedResult);
  } catch (err) {
    console.error("getProductBatches error:", err);
    res.status(500).json({ msg: err.message || "Failed to fetch product batches" });
  }
};

// ─── FIXED: Get available quantities for product batches ──────────────────────────

// exports.getProductBatchAvailability = async (req, res) => {
//   try {
//     const { productId } = req.params;
    
//     if (!mongoose.Types.ObjectId.isValid(productId)) {
//       return res.status(400).json({ msg: 'Invalid product ID' });
//     }

//     // ✅ FIX: Only return batches with available quantity > 0
//     const batches = await StockBatch.find({ 
//       productId: new mongoose.Types.ObjectId(productId),
//       quantityAvailable: { $gt: 0 }
//     })
//     .sort({ inwardDate: 1 })
//     .select('batchNo quantityAvailable purchasePrice mrp retailerPrice distributorPrice walkinPrice inwardDate');

//     res.json(batches);
//   } catch (err) {
//     console.error('getProductBatchAvailability error:', err);
//     res.status(500).json({ msg: err.message });
//   }
// };

// controllers/purchaseController.js - Add this function at the end

// ─── FIXED: Get available quantities for product batches ──────────────────────────

exports.getProductBatchAvailability = async (req, res) => {
  try {
    const { productId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ msg: 'Invalid product ID' });
    }

    // ✅ IMPORTANT: Only return batches with quantityAvailable > 0
    const batches = await StockBatch.find({ 
      productId: new mongoose.Types.ObjectId(productId),
      quantityAvailable: { $gt: 0 }  // ← This filters out zero stock
    })
    .sort({ inwardDate: 1 })
    .select('batchNo quantityAvailable purchasePrice mrp retailerPrice distributorPrice walkinPrice inwardDate');

    console.log(`[getProductBatchAvailability] Product ${productId}: Found ${batches.length} batches with available stock`);
    
    res.json(batches);
  } catch (err) {
    console.error('getProductBatchAvailability error:', err);
    res.status(500).json({ msg: err.message });
  }
};

// src/controllers/purchaseController.js

// ─── Get Stock Batches for Data Explorer ──────────────────────
exports.getStockBatches = async (req, res) => {
  try {
    const {
      search,
      product,
      batchNo,
      purchaseEntry,
      rackNo,
      expiryStatus,
      inwardDateFrom,
      inwardDateTo,
      sortKey = 'batchNo',
      sortDirection = 'desc',
      page = 1,
      limit = 50,
    } = req.query;

    // Build filter query
    const query = {};

    // ─── Product Filter ──────────────────────────────────────
    if (product && product !== 'all' && mongoose.Types.ObjectId.isValid(product)) {
      query.productId = new mongoose.Types.ObjectId(product);
    }

    // ─── Batch No Filter ─────────────────────────────────────
    if (batchNo && batchNo !== 'all') {
      query.batchNo = { $regex: batchNo, $options: 'i' };
    }

    // ─── Purchase Entry Filter ──────────────────────────────
    if (purchaseEntry && purchaseEntry !== 'all' && mongoose.Types.ObjectId.isValid(purchaseEntry)) {
      query.purchaseEntryId = new mongoose.Types.ObjectId(purchaseEntry);
    }

    // ─── Rack No Filter ─────────────────────────────────────
    if (rackNo && rackNo !== 'all') {
      query.rackNo = { $regex: rackNo, $options: 'i' };
    }

    // ─── Inward Date Range ──────────────────────────────────
    if (inwardDateFrom) {
      query.inwardDate = { $gte: new Date(inwardDateFrom) };
    }
    if (inwardDateTo) {
      query.inwardDate = { 
        ...query.inwardDate, 
        $lte: new Date(new Date(inwardDateTo).setHours(23, 59, 59, 999))
      };
    }

    // ─── Expiry Status ──────────────────────────────────────
    if (expiryStatus && expiryStatus !== 'all') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const thirtyDaysFromNow = new Date(today);
      thirtyDaysFromNow.setDate(today.getDate() + 30);

      if (expiryStatus === 'expired') {
        query.expiryDate = { $lt: today };
      } else if (expiryStatus === 'expiring-soon') {
        query.expiryDate = { $gte: today, $lte: thirtyDaysFromNow };
      } else if (expiryStatus === 'healthy') {
        query.expiryDate = { $gt: thirtyDaysFromNow };
      }
    }

    // ─── Search ──────────────────────────────────────────────
    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      query.$or = [
        { batchNo: searchRegex },
        { rackNo: searchRegex },
      ];
    }

    // ─── Aggregation Pipeline ────────────────────────────────
    const pipeline = [
      { $match: query },
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'purchaseentries',
          localField: 'purchaseEntryId',
          foreignField: '_id',
          as: 'purchase',
        },
      },
      { $unwind: { path: '$purchase', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          batchNo: 1,
          productName: '$product.name',
          productImage: '$product.image',
          sku: '$product.sku',
          purchaseEntry: '$purchase.purchaseNumber',
          rackNo: 1,
          expiryDate: 1,
          inwardDate: 1,
          quantityAvailable: 1,
          quantityPurchased: 1,
          purchasePrice: 1,
          expiryStatus: {
            $cond: [
              { $and: [{ $ne: ['$expiryDate', null] }, { $lt: ['$expiryDate', new Date()] }] },
              'expired',
              {
                $cond: [
                  { $and: [
                    { $ne: ['$expiryDate', null] },
                    { $lte: ['$expiryDate', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)] }
                  ]},
                  'expiring-soon',
                  'healthy'
                ]
              }
            ]
          },
        },
      },
    ];

    // ─── Sorting ──────────────────────────────────────────────
    const sortDirectionValue = sortDirection === 'asc' ? 1 : -1;
    const sortObj = {};
    
    // Map sort keys to actual fields
    const sortKeyMap = {
      batchNo: 'batchNo',
      productName: 'productName',
      sku: 'sku',
      rackNo: 'rackNo',
      inwardDate: 'inwardDate',
      quantityAvailable: 'quantityAvailable',
      purchasePrice: 'purchasePrice',
      purchaseEntry: 'purchaseEntry',
    };
    
    const actualSortKey = sortKeyMap[sortKey] || 'batchNo';
    sortObj[actualSortKey] = sortDirectionValue;
    
    pipeline.push({ $sort: sortObj });

    // ─── Pagination ──────────────────────────────────────────
    const skip = (parseInt(page) - 1) * parseInt(limit);
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: parseInt(limit) });

    // ─── Execute Query ───────────────────────────────────────
    const data = await StockBatch.aggregate(pipeline);

    // ─── Get Total Count ─────────────────────────────────────
    const countPipeline = [
      { $match: query },
      { $count: 'total' }
    ];
    const countResult = await StockBatch.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    res.json({
      data,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    console.error('getStockBatches error:', err);
    res.status(500).json({ msg: err.message });
  }
};