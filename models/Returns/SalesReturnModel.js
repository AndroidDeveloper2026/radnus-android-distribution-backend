const mongoose = require("mongoose");

const SalesReturnSchema = new mongoose.Schema(
  {
    // Auto-generated return number  e.g.  SRN-2025-2026/001
    returnNumber: { type: String, required: true, unique: true },
    financialYear: { type: String, required: true },
    sequence:      { type: Number, required: true },

    // Who raised the return (logged-in biller)
    billerName: { type: String, required: true },

    // Customer details
    customerName:     { type: String, required: true },
    referenceInvoice: { type: String, default: "" }, // original invoice number

    // Items being returned
    items: [
      {
        name:  { type: String, required: true },
        qty:   { type: Number, required: true },
        price: { type: Number, required: true },
      },
    ],

    totalAmount: { type: Number, required: true }, // total refund value
    reason:      { type: String, default: "" },
    status:      { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SalesReturn", SalesReturnSchema);
