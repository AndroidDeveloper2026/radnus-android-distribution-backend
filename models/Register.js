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

//+++++++++++++++++++++++++++++++++++++++++++++++++

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const RegisterSchema = new mongoose.Schema(
  {
    // Existing fields
    role: {
      type: String,
      enum: [
        "Admin",
        "MarketingManager",
        "MarketingExecutive",
        "Distributor",
        "FSE",
        "Retailer",
        "radnus_employee",  // ⭐ ADDED
      ],
      required: true,
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
    },
    password: {
      type: String,
      required: true,
    },
    fcmToken: {
      type: String,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    otp: {
      type: String,
    },
    otpExpiry: {
      type: Date,
    },
    resetOtp: {
      type: String,
    },
    resetOtpExpiry: {
      type: Date,
    },

    // ⭐ NEW FIELDS FOR EMPLOYEE REGISTRATION
    employeeId: {
      type: String,
      trim: true,
      uppercase: true,
    },
    registrationType: {
      type: String,
      enum: ['employee', 'external'],
      default: 'external',
    },
    status: {
      type: String,
      enum: ['pending_approval', 'approved', 'rejected'],
      default: 'pending_approval',
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Register',
    },
    approvedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving (if not already hashed)
RegisterSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Generate OTP
RegisterSchema.methods.generateOtp = function () {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.otp = otp;
  this.otpExpiry = new Date(Date.now() + 5 * 60 * 1000);
  return otp;
};

module.exports = mongoose.model("Register", RegisterSchema);