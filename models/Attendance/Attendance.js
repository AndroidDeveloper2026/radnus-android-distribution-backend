const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Register",
      required: true,
      index: true,
    },

    // Working date (IST). Stored as "YYYY-MM-DD" so a single string
    // uniquely identifies one employee's attendance for one working day.
    date: { type: String, required: true, index: true },

    checkInTime: { type: Date, default: null },
    checkOutTime: { type: Date, default: null },

    checkInLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      accuracy: { type: Number, default: 0 },
    },
    checkOutLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      accuracy: { type: Number, default: 0 },
    },

    status: {
      type: String,
      enum: ["PRESENT", "HALF_DAY", "ABSENT", "ON_LEAVE", "HOLIDAY", "WEEK_OFF"],
      default: "PRESENT",
    },

    workDurationMinutes: { type: Number, default: 0 },

    // Reference to existing FSE Session (only set for TRACKED_ROLES)
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      default: null,
    },

    remarks: { type: String, default: "" },

    // HR audit trail for manual corrections
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Register",
      default: null,
    },
    approvedAt: { type: Date, default: null },
    correctedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Register",
      default: null,
    },
    correctionReason: { type: String, default: "" },
  },
  { timestamps: true }
);

// ONE attendance per employee per working date.
attendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1, status: 1 });
attendanceSchema.index({ sessionId: 1 }, { sparse: true });

module.exports = mongoose.model("Attendance", attendanceSchema);

//------------- 08.10.26 Before change -----------------
// const mongoose = require("mongoose");

// const attendanceSchema = new mongoose.Schema(
//   {
//     employeeId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Register",
//       required: true,
//       index: true,
//     },

//     // Working date (IST). Stored as "YYYY-MM-DD" so a single string
//     // uniquely identifies one employee's attendance for one working day.
//     date: { type: String, required: true, index: true },

//     checkInTime: { type: Date, default: null },
//     checkOutTime: { type: Date, default: null },

//     checkInLocation: {
//       latitude: { type: Number, default: null },
//       longitude: { type: Number, default: null },
//       accuracy: { type: Number, default: 0 },
//     },
//     checkOutLocation: {
//       latitude: { type: Number, default: null },
//       longitude: { type: Number, default: null },
//       accuracy: { type: Number, default: 0 },
//     },

//     status: {
//       type: String,
//       enum: ["PRESENT", "LATE", "HALF_DAY", "ABSENT", "ON_LEAVE", "HOLIDAY", "WEEK_OFF"],
//       default: "PRESENT",
//     },

//     lateMinutes: { type: Number, default: 0 },
//     workDurationMinutes: { type: Number, default: 0 },

//     // Reference to existing FSE Session (only set for TRACKED_ROLES)
//     sessionId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Session",
//       default: null,
//     },

//     remarks: { type: String, default: "" },

//     // HR audit trail for manual corrections
//     approvedBy: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Register",
//       default: null,
//     },
//     approvedAt: { type: Date, default: null },
//     correctedBy: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Register",
//       default: null,
//     },
//     correctionReason: { type: String, default: "" },
//   },
//   { timestamps: true }
// );

// // ONE attendance per employee per working date.
// attendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });
// attendanceSchema.index({ date: 1, status: 1 });
// attendanceSchema.index({ sessionId: 1 }, { sparse: true });

// module.exports = mongoose.model("Attendance", attendanceSchema);