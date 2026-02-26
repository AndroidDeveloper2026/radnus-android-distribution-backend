const mongoose = require("mongoose");

const fseSchema = new mongoose.Schema({
  photo: String,

  name: { type: String, required: true },
  dob: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },

  altPhone: String,
  address: { type: String, required: true },
  altAddress: String,

  status: {
    type: String,
    enum: ["PENDING", "APPROVED", "REJECTED"],
    default: "PENDING",
  },

}, { timestamps: true });

module.exports = mongoose.model("FSE", fseSchema);