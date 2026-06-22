
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const registerSchema = new mongoose.Schema(
  {
    // 🔐 Authentication Fields
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    mobile: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // 📍 Location Fields
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

    // 👤 Role & Profile
    role: {
      type: String,
      enum: ["Admin", "Radnus", "MarketingManager", "MarketingExecutive", "Distributor", "FSE", "Retailer"],
      required: true,
    },

    // 🔐 OTP Fields
    otp: {
      type: String,
    },
    otpExpiry: {
      type: Date,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },

    // 🔑 Reset Password OTP
    resetOtp: {
      type: String,
    },
    resetOtpExpiry: {
      type: Date,
    },

    // 📱 FCM Token
    fcmToken: {
      type: String,
    },

    // ✅ APPROVAL SYSTEM FIELDS (NEW)
    isApproved: {
      type: Boolean,
      default: false,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Register",
    },
    approvedAt: {
      type: Date,
    },
    registrationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    rejectionReason: {
      type: String,
    },

    // 👔 EMPLOYEE SPECIFIC FIELDS (Radnus only)
    employeeId: {
      type: String,
      unique: true,
      sparse: true,
    },
    department: {
      type: String,
      enum: ["Sales", "Marketing", "Operations", "Admin", "Distribution"],
    },
    designation: {
      type: String,
    },
    joiningDate: {
      type: Date,
    },

    // 📸 Profile Photo
    photo: {
      type: String,
    },

    // 🕒 Timestamps
    lastLogin: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// 🔐 Hash password before saving
registerSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// 🎲 Generate OTP
registerSchema.methods.generateOtp = function () {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.otp = otp;
  this.otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
  return otp;
};

// 🔐 Compare password
registerSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("Register", registerSchema);
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

