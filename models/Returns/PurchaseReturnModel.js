// const mongoose = require("mongoose");

// const PurchaseReturnSchema = new mongoose.Schema(
//   {
//     // Auto-generated return number  e.g.  PRN-2025-2026/001
//     returnNumber: { type: String, required: true, unique: true },
//     financialYear: { type: String, required: true },
//     sequence:      { type: Number, required: true },

//     // Who raised the return (logged-in biller)
//     billerName: { type: String, required: true },

//     // Supplier / vendor details
//     supplierName: { type: String, required: true },
//     referencePO:  { type: String, default: "" }, // original purchase order / GRN number

//     // Items being returned to supplier
//     items: [
//       {
//         name:  { type: String, required: true },
//         qty:   { type: Number, required: true },
//         price: { type: Number, required: true },
//       },
//     ],

//     totalAmount: { type: Number, required: true }, // total credit note value
//     reason:      { type: String, default: "" },
//     status:      { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
//   },
//   { timestamps: true }
// );

// module.exports = mongoose.model("PurchaseReturn", PurchaseReturnSchema);

//------------------new code---------------------

const mongoose = require("mongoose");

const PurchaseReturnSchema = new mongoose.Schema(
  {
    // Auto-generated return number e.g. PRN-2025-2026/001
    returnNumber: { type: String, required: true, unique: true },
    financialYear: { type: String, required: true },
    sequence:      { type: Number, required: true },

    // Who raised the return (logged-in biller)
    billerName: { type: String, required: true },

    // Supplier / vendor details
    supplierName: { type: String, required: true },
    referencePO:  { type: String, default: "" }, // original purchase order / GRN number

    // Items being returned to supplier
    items: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },  // ✅ NEW
        name:      { type: String, required: true },
        qty:       { type: Number, required: true },
        price:     { type: Number, required: true },
      },
    ],

    totalAmount: { type: Number, required: true }, // total credit note value
    reason:      { type: String, default: "" },
    status:      { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PurchaseReturn", PurchaseReturnSchema);