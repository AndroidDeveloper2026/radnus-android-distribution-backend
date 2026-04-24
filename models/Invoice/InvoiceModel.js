// const mongoose = require("mongoose");

// // Subdocument for shipping address (Consignee)
// const ShippingAddressSchema = new mongoose.Schema({
//   name: { type: String },
//   phone: { type: String },
//   address: { type: String },
//   city: { type: String },
//   state: { type: String },
// });

// const InvoiceSchema = new mongoose.Schema(
//   {
//     // Existing fields
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
//         // optional: HSN, per, amount can be computed
//       },
//     ],
//     totalAmount: { type: Number, required: true },   // grand total (items + courier)
//     paymentMode: { type: String, required: true },
//     status: { type: String, enum: ["draft", "completed"], default: "draft" },

//     // ✨ NEW FIELDS for full invoice
//     // Buyer (Bill To) details
//     customerPhone: { type: String, required: true },
//     customerName: { type: String, required: true },
//     customerType: { type: String, enum: ["customer", "shop"], default: "customer" },
//     shopName: { type: String },
//     customerAddress: { type: String },
//     customerCity: { type: String },
//     customerState: { type: String },

//     // Consignee (Ship To)
//     sameAsBuyer: { type: Boolean, default: true },
//     shippingAddress: { type: ShippingAddressSchema, default: {} },

//     // Additional invoice metadata
//     subtotal: { type: Number, required: true },     // sum of items (without courier)
//     courierCharge: { type: Number, default: 0 },
//     salesperson: { type: String },
//     referenceNo: { type: String },

//     // Optional: date of invoice (already have timestamps, but explicit date field)
//     invoiceDate: { type: Date, default: Date.now },
//   },
//   { timestamps: true }
// );

// module.exports = mongoose.model("Invoice", InvoiceSchema);

//---------------

const mongoose = require("mongoose");

const ShippingAddressSchema = new mongoose.Schema({
  name: { type: String },
  phone: { type: String },
  address: { type: String },
  city: { type: String },
  state: { type: String },
});

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
    totalAmount: { type: Number, required: true },
    paymentMode: { type: String, required: true },
    status: { type: String, enum: ["draft", "completed"], default: "draft" },

    customerPhone: { type: String, required: true },
    customerName: { type: String, required: true },
    customerType: { type: String, enum: ["customer", "shop"], default: "customer" },
    shopName: { type: String },
    customerAddress: { type: String },
    customerCity: { type: String },
    customerState: { type: String },

    sameAsBuyer: { type: Boolean, default: true },
    shippingAddress: { type: ShippingAddressSchema, default: {} },

    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },    // ✅ DISCOUNT
    courierCharge: { type: Number, default: 0 },
    salesperson: { type: String },
    referenceNo: { type: String },
    invoiceDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Invoice", InvoiceSchema);