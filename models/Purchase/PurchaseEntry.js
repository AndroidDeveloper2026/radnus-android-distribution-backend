const mongoose = require("mongoose");

const PurchaseEntryItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true },
    purchasePrice: { type: Number, required: true },
    mrp: { type: Number, default: 0 },
    gst: { type: Number, default: 0 },
    rackNo: { type: String, default: "" },
    batchNo: { type: String, required: true },
    total: { type: Number, required: true },

    // Optional — captured only if the user edited them in Purchase Entry.
    // Also applied back onto the Product document (see purchaseController).
    itemCost: { type: Number },
    distributorPrice: { type: Number },
    retailerPrice: { type: Number },
    walkinPrice: { type: Number },
  },
  { _id: false }
);

const PurchaseEntrySchema = new mongoose.Schema(
  {
    // Auto-generated purchase number, e.g. PUR00045
    purchaseNumber: { type: String, required: true, unique: true },

    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },

    // Auto-generated invoice number, e.g. RC2026-2027/PUC/001
    // (RC = prefix/branch code, 2026-2027 = financial year, PUC = purchase
    // module code, 001 = sequence resetting each financial year)
    invoiceNumber: { type: String, required: true, unique: true },
    invoiceDate: { type: Date, required: true },

    paymentType: { type: String, enum: ["Cash", "Credit", "UPI", "Bank Transfer", "Cheque"], default: "Credit" },
    remarks: { type: String, default: "" },

    products: { type: [PurchaseEntryItemSchema], required: true },

    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true },

    paidAmount: { type: Number, default: 0 },
    dueAmount: { type: Number, default: 0 },

    // "paid" | "partial" | "unpaid" — derived at save time from paidAmount vs grandTotal
    paymentStatus: { type: String, enum: ["paid", "partial", "unpaid"], default: "unpaid" },

    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

// Purchase History search/filter/sort
PurchaseEntrySchema.index({ supplier: 1 });
PurchaseEntrySchema.index({ paymentStatus: 1 });
PurchaseEntrySchema.index({ createdAt: -1 });

module.exports = mongoose.model("PurchaseEntry", PurchaseEntrySchema);


// const mongoose = require("mongoose");

// const PurchaseEntryItemSchema = new mongoose.Schema(
//   {
//     productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
//     sku: { type: String, required: true },
//     name: { type: String, required: true },
//     quantity: { type: Number, required: true },
//     purchasePrice: { type: Number, required: true },
//     mrp: { type: Number, default: 0 },
//     gst: { type: Number, default: 0 },
//     rackNo: { type: String, default: "" },
//     batchNo: { type: String, required: true },
//     total: { type: Number, required: true },
//   },
//   { _id: false }
// );

// const PurchaseEntrySchema = new mongoose.Schema(
//   {
//     // Auto-generated purchase number e.g. PUR00045
//     purchaseNumber: { type: String, required: true, unique: true },

//     supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },

//     invoiceNumber: { type: String, required: true },
//     invoiceDate: { type: Date, required: true },

//     paymentType: { type: String, enum: ["Cash", "Credit", "UPI", "Bank Transfer", "Cheque"], default: "Credit" },
//     remarks: { type: String, default: "" },

//     products: { type: [PurchaseEntryItemSchema], required: true },

//     subtotal: { type: Number, required: true },
//     discount: { type: Number, default: 0 },
//     gstAmount: { type: Number, default: 0 },
//     grandTotal: { type: Number, required: true },

//     paidAmount: { type: Number, default: 0 },
//     dueAmount: { type: Number, default: 0 },

//     // "paid" | "partial" | "unpaid" — derived at save time from paidAmount vs grandTotal
//     paymentStatus: { type: String, enum: ["paid", "partial", "unpaid"], default: "unpaid" },

//     createdBy: { type: String, default: "" },
//   },
//   { timestamps: true }
// );

// // Purchase History search/filter/sort
// PurchaseEntrySchema.index({ purchaseNumber: 1 }, { unique: true });
// PurchaseEntrySchema.index({ supplier: 1 });
// PurchaseEntrySchema.index({ invoiceNumber: 1 });
// PurchaseEntrySchema.index({ paymentStatus: 1 });
// PurchaseEntrySchema.index({ createdAt: -1 });

// module.exports = mongoose.model("PurchaseEntry", PurchaseEntrySchema);