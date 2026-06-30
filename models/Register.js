// models/Register.js
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
        "Radnus",
        "Admin",
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

    photo: {
      type: String,
      default: null,
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

    // ⭐⭐ Approval fields
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Register",
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    approvalNotes: {
      type: String,
      default: null,
    },

    // ⭐⭐ Hierarchical approval system fields
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Register',
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Register',
      default: null,
    },

    rejectedAt: {
      type: Date,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

// Virtual for status
registerSchema.virtual('status').get(function () {
  if (!this.isActive) return 'Inactive';
  if (this.approvalStatus === 'pending') return 'Pending';
  if (this.approvalStatus === 'approved') return 'Approved';
  if (this.approvalStatus === 'rejected') return 'Rejected';
  return 'Pending';
});

registerSchema.set('toJSON', { virtuals: true });
registerSchema.set('toObject', { virtuals: true });

registerSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

registerSchema.methods.generateOtp = function () {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.otp = otp;
  this.otpExpiry = new Date(Date.now() + 5 * 60 * 1000);
  return otp;
};

module.exports = mongoose.model("Register", registerSchema);

//+++++++++++++++++++++++++++++++++++++++++++

// // models/Register.js
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
//         "Admin",
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

//     // ⭐⭐ Admin-approval fields — ONLY meaningful/enforced for role === "Radnus".
//     // For every other role these default to "approved"/true and are never
//     // checked at login, so existing login behaviour is unchanged.
//     approvalStatus: {
//       type: String,
//       enum: ["pending", "approved", "rejected"],
//       default: "approved",
//     },
//     isApproved: {
//       type: Boolean,
//       default: true,
//     },
//     approvedBy: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Register",
//       default: null,
//     },
//     approvedAt: {
//       type: Date,
//       default: null,
//     },
//     rejectionReason: {
//       type: String,
//       default: null,
//     },
//     approvalNotes: {
//       type: String,
//       default: null,
//     },

//     // ⭐⭐ Hierarchical approval system fields (generalized for ALL roles,
//     // not just Radnus). These are additive — existing roles/flows that
//     // don't use them keep working exactly as before.

//     // The immediate parent/approver this user belongs to in the hierarchy
//     // (e.g. a Retailer's parent is the FSE who approves them).
//     parentId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'Register',
//       default: null,
//     },

//     // Who created this account. For self-registration this is null;
//     // for accounts created by an admin/parent on someone's behalf this
//     // can be populated.
//     createdBy: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'Register',
//       default: null,
//     },

//     rejectedAt: {
//       type: Date,
//       default: null,
//     },

//     // Active/Inactive toggle, independent of the approval workflow.
//     isActive: {
//       type: Boolean,
//       default: true,
//     },
//   },
//   { timestamps: true },
// );

// // Virtual convenience field that mirrors `approvalStatus` using the
// // "status" terminology used across the approval feature spec
// // (Pending / Approved / Rejected). Kept as a virtual so we don't store
// // duplicate data — `approvalStatus` remains the single source of truth.
// registerSchema.virtual('status').get(function () {
//   if (!this.isActive) return 'Inactive';
//   if (this.approvalStatus === 'pending') return 'Pending';
//   if (this.approvalStatus === 'approved') return 'Approved';
//   if (this.approvalStatus === 'rejected') return 'Rejected';
//   return 'Pending';
// });

// registerSchema.set('toJSON', { virtuals: true });
// registerSchema.set('toObject', { virtuals: true });

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

// //++++++++++++++++++++++++++++++++++++++++

// // const mongoose = require("mongoose");
// // const bcrypt = require("bcrypt");

// // const registerSchema = new mongoose.Schema(
// //   {
// //     role: {
// //       type: String,
// //       required: true,
// //       enum: [
// //         "Distributor",
// //         "FSE",
// //         "Retailer",
// //         "MarketingManager",
// //         "MarketingExecutive",
// //         "Radnus",
// //       ],
// //     },

// //     state: {
// //       type: String,
// //       required: true,
// //     },

// //     district: {
// //       type: String,
// //       required: true,
// //     },

// //     taluk: {
// //       type: String,
// //       required: true,
// //     },

// //     name: {
// //       type: String,
// //       required: true,
// //       trim: true,
// //     },

// //     email: {
// //       type: String,
// //       required: true,
// //       unique: true,
// //     },

// //     mobile: {
// //       type: String,
// //       required: true,
// //       unique: true,
// //       match: /^[6-9]\d{9}$/,
// //     },

// //     password: {
// //       type: String,
// //       required: true,
// //       minlength: 6,
// //     },

// //     photo: {
// //       type: String, // Cloudinary URL for Executive/Agent photo
// //       default: null,
// //     },

// //     // ⭐ FCM TOKEN
// //     fcmToken: {
// //       type: String,
// //       default: null,
// //     },

// //     // ⭐ OTP
// //     otp: {
// //       type: String,
// //       default: null,
// //     },

// //     otpExpiry: {
// //       type: Date,
// //       default: null,
// //     },

// //     // ⭐ Verify Status
// //     isVerified: {
// //       type: Boolean,
// //       default: false,
// //     },

// //     resetOtp: {
// //       type: String,
// //     },
// //     resetOtpExpiry: {
// //       type: Date,
// //     },
// //   },
// //   { timestamps: true },
// // );

// // registerSchema.pre("save", async function () {
// //   if (!this.isModified("password")) return;
// //   this.password = await bcrypt.hash(this.password, 10);
// // });

// // registerSchema.methods.generateOtp = function () {
// //   const otp = Math.floor(100000 + Math.random() * 900000).toString();

// //   this.otp = otp;
// //   this.otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // ✅ Date object

// //   return otp;
// // };

// // module.exports = mongoose.model("Register", registerSchema);
