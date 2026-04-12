// const mongoose = require("mongoose");

// const InvoiceSchema = new mongoose.Schema(
//   {
//     invoiceNumber: { type: String, required: true, unique: true },

//     financialYear: { type: String, required: true },
//     sequence: { type: Number, required: true },

//     billerName: { type: String, required: true },

//     items: [
//       {
//         productId: String,
//         name: String,
//         qty: Number,
//         price: Number,
//       },
//     ],

//     totalAmount: Number,
//     paymentMode: String,
//   },
//   { timestamps: true }
// );

// module.exports = mongoose.model("Invoice", InvoiceSchema);

//------------------
const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    financialYear: { type: String, required: true },
    sequence: { type: Number, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // 👈 NEW
    billerName: { type: String, required: true },
    salesperson: { type: String, required: true }, // 👈 NEW
    items: [
      {
        productId: { type: String, required: true },
        name: { type: String, required: true },
        qty: { type: Number, required: true },
        price: { type: Number, required: true },
      },
    ],
    totalAmount: { type: Number, required: true },
    paymentMode: { type: String, required: true },
    courierCharge: { type: Number, default: 0 }, // 👈 NEW
    referenceNo: { type: String, default: '' }, // 👈 NEW
    shippingAddress: { // 👈 NEW
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
      address: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Invoice', invoiceSchema);