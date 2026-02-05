const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const registerSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      required: true,
      enum: ["Distributor", "FSE", "Retailer"],
    },

    state: {
      type: String,
      required: true,
    },

    district: {
      type: String,
      required: true,
    },

    taluk: {
      type: String,
      required: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
    },

    mobile: {
      type: String,
      required: true,
      unique: true,
      match: /^[6-9]\d{9}$/,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
    },
  },
  { timestamps: true },
);

// 🔐 Hash password before save
registerSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
});

module.exports = mongoose.model("Register", registerSchema);
