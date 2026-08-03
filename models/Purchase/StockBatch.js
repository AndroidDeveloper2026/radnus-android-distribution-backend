
const mongoose = require("mongoose");

const StockBatchSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    purchaseEntryId: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseEntry", required: true },

    // Auto-generated e.g. B20260713-001
    batchNo: { type: String, required: true, unique: true },

    inwardDate: { type: Date, default: Date.now },
    purchasePrice: { type: Number, required: true },

    // ✅ Selling price fields - these were missing before
    mrp: { type: Number, default: 0 },
    itemCost: { type: Number, default: 0 },
    distributorPrice: { type: Number, default: 0 },
    retailerPrice: { type: Number, default: 0 },
    walkinPrice: { type: Number, default: 0 },

    quantityPurchased: { type: Number, required: true },
    quantityAvailable: { type: Number, required: true },

    rackNo: { type: String, default: "" },
    expiryDate: { type: Date, default: null },
  },
  { timestamps: true }
);

// Indexes
StockBatchSchema.index({ productId: 1, inwardDate: 1 });
StockBatchSchema.index({ productId: 1, quantityAvailable: 1 });
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
