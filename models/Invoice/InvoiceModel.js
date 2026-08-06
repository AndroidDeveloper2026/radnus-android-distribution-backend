
// models/Invoice/InvoiceModel.js
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
        batchAllocations: [
          {
            batchId: { type: mongoose.Schema.Types.ObjectId, ref: "StockBatch" },
            batchNo: String,
            qty: Number,
            purchaseCost: Number,
          },
        ],
      },
    ],
    totalAmount: { type: Number, required: true },
    paymentMode: { type: String, required: true },
    status: { type: String, enum: ["draft", "completed"], default: "draft" },

    customerPhone: { type: String, required: true },
    customerName: { type: String, required: true },
    customerType: {
      type: String,
      enum: ["customer", "shop"],
      default: "customer",
    },
    shopName: { type: String },
    customerAddress: { type: String },
    customerCity: { type: String },
    customerState: { type: String },

    sameAsBuyer: { type: Boolean, default: true },
    shippingAddress: { type: ShippingAddressSchema, default: {} },

    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    courierCharge: { type: Number, default: 0 },
    salesperson: { type: String },
    referenceNo: { type: String },
    invoiceDate: { type: Date, default: Date.now },
    orderType: {
      type: String,
      enum: ["OEM", "TOOLS"],
      default: "",
    },
    priceType: {
      type: String,
      enum: ["retailerPrice", "distributorPrice", "walkinPrice", "mrp"],
      default: "retailerPrice",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Invoice", InvoiceSchema);

//-------------- old working code before qty --------------------
// // models/Invoice/InvoiceModel.js

// const mongoose = require("mongoose");

// const ShippingAddressSchema = new mongoose.Schema({
//   name: { type: String },
//   phone: { type: String },
//   address: { type: String },
//   city: { type: String },
//   state: { type: String },
// });

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
//         batchAllocations: [
//           {
//             batchId: { type: mongoose.Schema.Types.ObjectId, ref: "StockBatch" },
//             batchNo: String,
//             qty: Number,
//             purchaseCost: Number,
//           },
//         ],
//       },
//     ],
//     totalAmount: { type: Number, required: true },
//     paymentMode: { type: String, required: true },
//     status: { type: String, enum: ["draft", "completed"], default: "draft" },

//     customerPhone: { type: String, required: true },
//     customerName: { type: String, required: true },
//     customerType: {
//       type: String,
//       enum: ["customer", "shop"],
//       default: "customer",
//     },
//     shopName: { type: String },
//     customerAddress: { type: String },
//     customerCity: { type: String },
//     customerState: { type: String },

//     sameAsBuyer: { type: Boolean, default: true },
//     shippingAddress: { type: ShippingAddressSchema, default: {} },

//     subtotal: { type: Number, required: true },
//     discount: { type: Number, default: 0 },
//     courierCharge: { type: Number, default: 0 },
//     salesperson: { type: String },
//     referenceNo: { type: String },
//     invoiceDate: { type: Date, default: Date.now },
//     orderType: {
//       type: String,
//       enum: ["OEM", "TOOLS"],
//       default: "",
//     },
//     priceType: {
//       type: String,
//       enum: ["retailerPrice", "distributorPrice", "walkinPrice", "mrp"],
//       default: "retailerPrice",
//     },
//   },
//   { timestamps: true },
// );

// module.exports = mongoose.model("Invoice", InvoiceSchema);
