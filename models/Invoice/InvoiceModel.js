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
        // NEW — FIFO batch trail. Optional so existing invoices created
        // before this feature (which have no batch data) still validate.
        // Each entry records exactly which batch a portion of this line's
        // qty was drawn from, so returns can restore stock to the right
        // place instead of the newest batch.
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
    discount: { type: Number, default: 0 }, // ✅ DISCOUNT
    courierCharge: { type: Number, default: 0 },
    salesperson: { type: String },
    referenceNo: { type: String },
    invoiceDate: { type: Date, default: Date.now },
    orderType: {
      type: String,
      enum: ["OEM", "TOOLS"],
      default: "",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Invoice", InvoiceSchema);



//======== Below working code ======================
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
//     discount: { type: Number, default: 0 }, // ✅ DISCOUNT
//     courierCharge: { type: Number, default: 0 },
//     salesperson: { type: String },
//     referenceNo: { type: String },
//     invoiceDate: { type: Date, default: Date.now },
//     orderType: {
//       type: String,
//       enum: ["OEM", "TOOLS"],
//       default: "",
//     },
//   },
//   { timestamps: true },
// );

// module.exports = mongoose.model("Invoice", InvoiceSchema);
