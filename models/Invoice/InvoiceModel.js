const mongoose = require("mongoose");

const InvoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },

    financialYear: { type: String, required: true },
    sequence: { type: Number, required: true },

    billerName: { type: String, required: true },

    items: [
      {
        productId: String,
        name: String,
        qty: Number,
        price: Number,
      },
    ],

    totalAmount: Number,
    paymentMode: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Invoice", InvoiceSchema);

