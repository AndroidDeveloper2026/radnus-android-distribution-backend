const mongoose = require("mongoose");

const SalesReturnSchema = new mongoose.Schema(
  {
    returnNumber: { type: String, required: true, unique: true },
    financialYear: { type: String, required: true },
    sequence:      { type: Number, required: true },

    billerName: { type: String, required: true },

    customerName:     { type: String, required: true },
    referenceInvoice: { type: String, default: "" },

    items: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        name:      { type: String, required: true },
        qty:       { type: Number, required: true },
        price:     { type: Number, required: true },
        // NEW — which batch(es) to restore stock into, copied from the
        // original invoice line's batchAllocations. Optional so returns
        // against pre-FIFO invoices (no batch data) still work — those
        // fall back to the old Product.moq increment (see returnsController).
        batchAllocations: [
          {
            batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'StockBatch' },
            batchNo: String,
            qty: Number,
          },
        ],
      },
    ],

    totalAmount: { type: Number, required: true },
    reason:      { type: String, default: "" },
    status:      { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SalesReturn", SalesReturnSchema);

//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// const mongoose = require("mongoose");

// const SalesReturnSchema = new mongoose.Schema(
//   {
//     returnNumber: { type: String, required: true, unique: true },
//     financialYear: { type: String, required: true },
//     sequence:      { type: Number, required: true },

//     billerName: { type: String, required: true },

//     customerName:     { type: String, required: true },
//     referenceInvoice: { type: String, default: "" },

//     items: [
//       {
//         productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
//         name:      { type: String, required: true },
//         qty:       { type: Number, required: true },
//         price:     { type: Number, required: true },
//       },
//     ],

//     totalAmount: { type: Number, required: true },
//     reason:      { type: String, default: "" },
//     status:      { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
//   },
//   { timestamps: true }
// );

// module.exports = mongoose.model("SalesReturn", SalesReturnSchema);