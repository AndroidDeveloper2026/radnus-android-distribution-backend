const mongoose = require("mongoose");

const StockBatchSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    purchaseEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseEntry", required: true },

    // Auto-generated e.g. B20260713-001
    batchNo: { type: String, required: true, unique: true },

    inwardDate: { type: Date, default: Date.now },
    purchasePrice: { type: Number, required: true },

    // Selling prices AS RECORDED AT THE TIME THIS BATCH WAS PURCHASED (only
    // set if the user actually edited them on the Purchase Entry — see
    // purchaseController's numOrUndefined). Kept per-batch (not just on the
    // Product) so switching pricing mode on a specific batch in Place Order,
    // or picking Batch A vs Batch B, reflects THAT batch's own price history
    // instead of only ever showing the product's current price. When a batch
    // has no override for a given mode (legacy batches, or fields left blank),
    // callers fall back to the product's current price for that mode.
    mrp: { type: Number },
    itemCost: { type: Number },
    distributorPrice: { type: Number },
    retailerPrice: { type: Number },
    walkinPrice: { type: Number },

    quantityPurchased: { type: Number, required: true },
    quantityAvailable: { type: Number, required: true },

    rackNo: { type: String, default: "" },
    expiryDate: { type: Date, default: null },
  },
  { timestamps: true }
);

// Stock Aging / FIFO-LIFO / Non-Moving Stock reports all filter/sort by these
StockBatchSchema.index({ productId: 1, inwardDate: 1 }); // FIFO ordering per product
StockBatchSchema.index({ productId: 1, quantityAvailable: 1 }); // find batches with remaining stock
StockBatchSchema.index({ purchaseEntryId: 1 });
StockBatchSchema.index({ expiryDate: 1 });

module.exports = mongoose.model("StockBatch", StockBatchSchema);

//----- 01.08.2026 -------------------
// const mongoose = require("mongoose");

// const StockBatchSchema = new mongoose.Schema(
//   {
//     productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
//     purchaseEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseEntry", required: true },

//     // Auto-generated e.g. B20260713-001
//     batchNo: { type: String, required: true, unique: true },

//     inwardDate: { type: Date, default: Date.now },
//     purchasePrice: { type: Number, required: true },

//     quantityPurchased: { type: Number, required: true },
//     quantityAvailable: { type: Number, required: true },

//     rackNo: { type: String, default: "" },
//     expiryDate: { type: Date, default: null },
//   },
//   { timestamps: true }
// );

// // Stock Aging / FIFO-LIFO / Non-Moving Stock reports all filter/sort by these
// StockBatchSchema.index({ productId: 1, inwardDate: 1 }); // FIFO ordering per product
// StockBatchSchema.index({ productId: 1, quantityAvailable: 1 }); // find batches with remaining stock
// StockBatchSchema.index({ purchaseEntryId: 1 });
// StockBatchSchema.index({ expiryDate: 1 });

// module.exports = mongoose.model("StockBatch", StockBatchSchema);

// //------------------------------------------------------------------

// // const mongoose = require("mongoose");

// // const StockBatchSchema = new mongoose.Schema(
// //   {
// //     productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
// //     purchaseEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseEntry", required: true },

// //     // Auto-generated e.g. SKU-0001
// //     batchNo: { type: String, required: true, unique: true },

// //     inwardDate: { type: Date, default: Date.now },
// //     purchasePrice: { type: Number, required: true },

// //     quantityPurchased: { type: Number, required: true },
// //     quantityAvailable: { type: Number, required: true },

// //     rackNo: { type: String, default: "" },
// //     expiryDate: { type: Date, default: null },
// //   },
// //   { timestamps: true }
// // );

// // // Stock Aging / FIFO-LIFO / Non-Moving Stock reports all filter/sort by these
// // StockBatchSchema.index({ batchNo: 1 }, { unique: true });
// // StockBatchSchema.index({ productId: 1, inwardDate: 1 }); // FIFO ordering per product
// // StockBatchSchema.index({ productId: 1, quantityAvailable: 1 }); // find batches with remaining stock
// // StockBatchSchema.index({ purchaseEntryId: 1 });
// // StockBatchSchema.index({ expiryDate: 1 });

// // module.exports = mongoose.model("StockBatch", StockBatchSchema);
