const mongoose = require("mongoose");

const executiveSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },

    dob: String,

    email: String,

    phone: String,

    alternatePhone: String,

    address: String,

    photo: String,

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Executive", executiveSchema);