const mongoose = require("mongoose");

const distributorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    businessName: { type: String, required: true },
    mobile: { type: String, required: true },
    alternateMobile: String,
    gst: String,
    msme: String,
    address: String,
    communicationAddress: String,

    // ✅ ADD THIS
    images: {
      profile: String,
    },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Distributor", distributorSchema);