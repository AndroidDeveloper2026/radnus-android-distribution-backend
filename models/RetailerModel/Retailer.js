const mongoose = require("mongoose");

const retailerSchema = new mongoose.Schema(
  {
    shopName: String,
    ownerName: String,
    mobile: String,
    gps: String,
    shopPhoto: String,

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Retailer", retailerSchema);