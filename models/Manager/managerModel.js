const mongoose = require("mongoose");

const managerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },

    dob: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
    },

    phone: {
      type: String,
      required: true,
    },

    alternatePhone: {
      type: String,
    },

    address: {
      type: String,
      required: true,
    },

    photo: {
      type: String,
    },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Manager", managerSchema);