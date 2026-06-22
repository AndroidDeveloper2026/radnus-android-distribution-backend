// models/Register.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const RegisterSchema = new mongoose.Schema({
  // Existing fields...
  role: {
    type: String,
    enum: ['MarketingManager', 'MarketingExecutive', 'Distributor', 'FSE', 'Retailer', 'Radnus'],
    required: true
  },
  state: { type: String, required: true },
  district: { type: String, required: true },
  taluk: { type: String, required: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  mobile: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  fcmToken: { type: String },
  
  // New fields for approval system
  isVerified: { type: Boolean, default: false },
  isApproved: { type: Boolean, default: false },  // ✅ Only for Radnus
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Register' },
  approvedAt: { type: Date },
  rejectionReason: { type: String },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  
  // OTP fields
  otp: { type: String },
  otpExpiry: { type: Date },
  resetOtp: { type: String },
  resetOtpExpiry: { type: Date },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Pre-save hook for password hashing
RegisterSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Generate OTP method
RegisterSchema.methods.generateOtp = function() {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.otp = otp;
  this.otpExpiry = new Date(Date.now() + 5 * 60 * 1000);
  return otp;
};

module.exports = mongoose.model('Register', RegisterSchema);

//------------  below code is old ----------

// const mongoose = require("mongoose");
// const bcrypt = require("bcrypt");

// const registerSchema = new mongoose.Schema(
//   {
//     role: {
//       type: String,
//       required: true,
//       enum: [
//         "Distributor",
//         "FSE",
//         "Retailer",
//         "MarketingManager",
//         "MarketingExecutive",
//         "Radnus",
//       ],
//     },

//     state: {
//       type: String,
//       required: true,
//     },

//     district: {
//       type: String,
//       required: true,
//     },

//     taluk: {
//       type: String,
//       required: true,
//     },

//     name: {
//       type: String,
//       required: true,
//       trim: true,
//     },

//     email: {
//       type: String,
//       required: true,
//       unique: true,
//     },

//     mobile: {
//       type: String,
//       required: true,
//       unique: true,
//       match: /^[6-9]\d{9}$/,
//     },

//     password: {
//       type: String,
//       required: true,
//       minlength: 6,
//     },

//     photo: {
//       type: String, // Cloudinary URL for Executive/Agent photo
//       default: null,
//     },

//     // ⭐ FCM TOKEN
//     fcmToken: {
//       type: String,
//       default: null,
//     },

//     // ⭐ OTP
//     otp: {
//       type: String,
//       default: null,
//     },

//     otpExpiry: {
//       type: Date,
//       default: null,
//     },

//     // ⭐ Verify Status
//     isVerified: {
//       type: Boolean,
//       default: false,
//     },

//     resetOtp: {
//       type: String,
//     },
//     resetOtpExpiry: {
//       type: Date,
//     },
//   },
//   { timestamps: true },
// );

// registerSchema.pre("save", async function () {
//   if (!this.isModified("password")) return;
//   this.password = await bcrypt.hash(this.password, 10);
// });

// registerSchema.methods.generateOtp = function () {
//   const otp = Math.floor(100000 + Math.random() * 900000).toString();

//   this.otp = otp;
//   this.otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // ✅ Date object

//   return otp;
// };

// module.exports = mongoose.model("Register", registerSchema);

