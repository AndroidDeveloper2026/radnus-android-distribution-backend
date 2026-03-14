const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const registerSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      required: true,
      enum: [
        "Distributor",
        "FSE",
        "Retailer",
        "MarketingManager",
        "MarketingExecutive",
        "Radnus"
      ],
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

    // ⭐ FCM TOKEN
    fcmToken: {
      type: String,
      default: null,
    },

    // ⭐ OTP
    otp: {
      type: String,
      default: null,
    },

    otpExpiry: {
      type: Date,
      default: null,
    },

    // ⭐ Verify Status
    isVerified: {
      type: Boolean,
      default: false,
    },

    resetOtp: {
      type: String,
    },
    resetOtpExpiry: {
      type: Date,
    },
    
  },
  { timestamps: true },
);


registerSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

registerSchema.methods.generateOtp = function () {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  this.otp = otp;
  this.otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // ✅ Date object

  return otp;
};


module.exports = mongoose.model("Register", registerSchema);
