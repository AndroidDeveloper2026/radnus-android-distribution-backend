const mongoose = require("mongoose");

const SalespersonSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: String,
      default: "system",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Salesperson", SalespersonSchema);