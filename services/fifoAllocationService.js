// services/fifoAllocationService.js
//
// Core FIFO (First In, First Out) batch allocation logic for billing.
// Kept intentionally framework-agnostic (no req/res) so it can be:
//   1. Reused by both the "preview allocation" endpoint (read-only) and the
//      real invoice-creation endpoint (read + write, inside a transaction).
//   2. Unit tested in isolation without spinning up Express.
//
// Reuses the existing StockBatch model — no schema changes needed.

const mongoose = require("mongoose");
const StockBatch = require("../models/Purchase/StockBatch");

class InsufficientStockError extends Error {
  constructor(productId, requested, available) {
    super(
      `Insufficient stock for product ${productId}: requested ${requested}, only ${available} available`
    );
    this.name = "InsufficientStockError";
    this.productId = productId;
    this.requested = requested;
    this.available = available;
  }
}

// Read-only: returns the FIFO-ordered batch queue for a product, whatever
// the current quantityAvailable values are. Used to render "Current Batch",
// "Next Batch", "Upcoming Batches" and the "Batch Queue" UI sections.
async function getBatchQueue(productId, session = null) {
  const batches = await StockBatch.find({ productId })
    .sort({ inwardDate: 1, createdAt: 1 })
    .session(session)
    .populate({
      path: "purchaseEntryId",
      select: "supplier invoiceNumber",
      populate: { path: "supplier", select: "name" },
    })
    .lean();

  return batches.map((b, idx) => ({
    batchId: b._id,
    batchNo: b.batchNo,
    inwardDate: b.inwardDate,
    purchasePrice: b.purchasePrice,
    quantityPurchased: b.quantityPurchased,
    quantityAvailable: b.quantityAvailable,
    supplierName: b.purchaseEntryId?.supplier?.name || "—",
    invoiceNumber: b.purchaseEntryId?.invoiceNumber || "—",
    rackNo: b.rackNo || "",
    // Position in the FIFO queue and a UI-friendly status.
    // "active"   -> oldest batch with stock left (this is what billing will draw from first)
    // "waiting"  -> has stock, but an older batch will be consumed first
    // "finished" -> no stock left
    position: idx + 1,
    status:
      b.quantityAvailable <= 0
        ? "finished"
        : idx === batches.findIndex((x) => x.quantityAvailable > 0)
        ? "active"
        : "waiting",
  }));
}

// Given a required quantity, greedily allocate against batches ordered
// oldest-first (by inwardDate). Does NOT write anything — pure computation
// — so it's safe to call for a live "preview" as the cashier types a qty.
//
// batches: pass in pre-fetched batches (already sorted, already scoped to
// quantityAvailable > 0) when calling inside a transaction, to avoid a
// second query; otherwise pass null and this function fetches them itself.
async function computeAllocation(productId, qty, { session = null, batches = null } = {}) {
  const requested = Number(qty);
  if (!requested || requested <= 0) {
    throw new Error("Quantity must be a positive number");
  }

  const source =
    batches ||
    (await StockBatch.find({ productId, quantityAvailable: { $gt: 0 } })
      .sort({ inwardDate: 1, createdAt: 1 })
      .session(session)
      .lean());

  let remaining = requested;
  const allocations = [];

  for (const batch of source) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantityAvailable, remaining);
    if (take <= 0) continue;
    allocations.push({
      batchId: batch._id,
      batchNo: batch.batchNo,
      qty: take,
      purchaseCost: batch.purchasePrice,
      inwardDate: batch.inwardDate,
    });
    remaining -= take;
  }

  if (remaining > 0) {
    const totalAvailable = source.reduce((sum, b) => sum + b.quantityAvailable, 0);
    throw new InsufficientStockError(productId, requested, totalAvailable);
  }

  return allocations;
}

// Writes: actually consumes the batches for a confirmed sale. Must be called
// inside a Mongoose session/transaction by the caller (see billingController).
// Uses a conditional $inc (quantityAvailable: {$gte: take}) as an optimistic
// concurrency guard — if another cashier already consumed the batch between
// our read and this write, the update matches 0 documents and we throw,
// letting the transaction roll back cleanly rather than driving stock negative.
async function consumeAllocations(allocations, session) {
  for (const alloc of allocations) {
    const result = await StockBatch.updateOne(
      { _id: alloc.batchId, quantityAvailable: { $gte: alloc.qty } },
      { $inc: { quantityAvailable: -alloc.qty } },
      { session }
    );
    if (result.matchedCount === 0) {
      throw new InsufficientStockError(alloc.batchId, alloc.qty, "concurrently modified");
    }
  }
}

// Reverse of consumeAllocations — used by Sales Returns to restore stock to
// the EXACT batches an invoice line originally drew from (never the newest
// batch, never a generic pool).
async function restoreAllocations(allocations, session) {
  for (const alloc of allocations) {
    await StockBatch.updateOne(
      { _id: alloc.batchId },
      { $inc: { quantityAvailable: alloc.qty } },
      { session }
    );
  }
}

module.exports = {
  InsufficientStockError,
  getBatchQueue,
  computeAllocation,
  consumeAllocations,
  restoreAllocations,
};
