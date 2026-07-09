const mongoose = require("mongoose");

const SupplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    mobile: { type: String, default: "" },
    email: { type: String, default: "" },
    gstNo: { type: String, default: "" },
    address: { type: String, default: "" },
    status: { type: String, enum: ["Active", "Inactive"], default: "Active" },
  },
  { timestamps: true }
);

// Fast lookups on supplier picker / search
SupplierSchema.index({ name: 1 });
SupplierSchema.index({ status: 1 });
SupplierSchema.index({ gstNo: 1 });

module.exports = mongoose.model("Supplier", SupplierSchema);
