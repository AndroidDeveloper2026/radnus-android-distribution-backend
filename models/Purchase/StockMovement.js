
// models/Purchase/StockMovement.js
const mongoose = require("mongoose");

const StockMovementSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    batchNo: { type: String, default: "" },

    // "purchase" | "sale" | "sales_return" | "purchase_return" | "adjustment"
    type: {
      type: String,
      enum: ["purchase", "sale", "sales_return", "purchase_return", "adjustment"],
      required: true,
    },

    // Positive = stock in, Negative = stock out
    quantity: { type: Number, required: true },

    // e.g. the PurchaseEntry _id, Invoice _id, SalesReturn _id, PurchaseReturn _id
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    referenceType: { type: String, default: "" },
  },
  { timestamps: true }
);

StockMovementSchema.index({ productId: 1, createdAt: -1 });
StockMovementSchema.index({ batchNo: 1 });
StockMovementSchema.index({ type: 1 });
StockMovementSchema.index({ referenceId: 1, referenceType: 1 });

module.exports = mongoose.model("StockMovement", StockMovementSchema);

//---------------- old cworking code of qty -----------------------
// const mongoose = require("mongoose");

// const StockMovementSchema = new mongoose.Schema(
//   {
//     productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
//     batchNo: { type: String, default: "" },

//     // "purchase" | "sale" | "sales_return" | "purchase_return" | "adjustment"
//     type: {
//       type: String,
//       enum: ["purchase", "sale", "sales_return", "purchase_return", "adjustment"],
//       required: true,
//     },

//     // Positive = stock in, Negative = stock out
//     quantity: { type: Number, required: true },

//     // e.g. the PurchaseEntry _id, Invoice _id, SalesReturn _id, PurchaseReturn _id
//     referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
//     referenceType: { type: String, default: "" },
//   },
//   { timestamps: true }
// );

// // Stock Movement / Non-Moving Stock reports query by product + date, or by type
// StockMovementSchema.index({ productId: 1, createdAt: -1 });
// StockMovementSchema.index({ batchNo: 1 });
// StockMovementSchema.index({ type: 1 });
// StockMovementSchema.index({ referenceId: 1, referenceType: 1 });

// module.exports = mongoose.model("StockMovement", StockMovementSchema);
