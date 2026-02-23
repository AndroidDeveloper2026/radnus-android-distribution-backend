const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    sku: { type: String, required: true, unique: true },
    category: { type: String, required: true },

    mrp: { type: Number, required: true },
    distributorPrice: { type: Number, required: true },
    retailerPrice: { type: Number, required: true },

    gst: { type: Number, default: 0 },
    moq: { type: Number, default: 1 },

    image: { type: String }, 
    status: { type: String, default: "Active" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product", productSchema);
