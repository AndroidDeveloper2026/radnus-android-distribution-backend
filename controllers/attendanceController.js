const mongoose = require("mongoose");
const Attendance = require("../models/Attendance/Attendance");
const Register = require("../models/Register");
const {
  upsertCheckIn,
  upsertCheckOut,
  istDateKey,
} = require("../services/attendanceService");
const { canViewUser, getSubordinateIds } = require("../utils/hierarchyScope");
const policy = require("../config/hrPolicy");

// ── Helpers ────────────────────────────────────────────────────────────
const pickLocation = (body) => {
  if (!body) return null;
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { latitude: lat, longitude: lng, accuracy: Number(body.accuracy) || 0 };
};

const ADMIN_LIKE_ROLES = ["Admin"];

// Who can view WHOSE attendance. Mirrors hierarchyScope.canViewUser.
async function canManageAttendanceOf(reqUser, targetUserId) {
  if (ADMIN_LIKE_ROLES.includes(reqUser.role)) return true;
  if (String(reqUser.id) === String(targetUserId)) return true;
  return canViewUser(reqUser, targetUserId);
}

// ── Self-service ───────────────────────────────────────────────────────

// POST /api/attendance/check-in   { latitude?, longitude?, accuracy? }
exports.checkIn = async (req, res) => {
  try {
    const employeeId = req.user.id; // NEVER trust body
    const location = pickLocation(req.body);

    const { attendance, alreadyCheckedIn } = await upsertCheckIn({
      employeeId,
      when: new Date(),
      location,
    });

    return res.status(alreadyCheckedIn ? 200 : 201).json({
      success: true,
      alreadyCheckedIn,
      attendance,
    });
  } catch (err) {
    console.error("attendance.checkIn:", err);
    return res.status(400).json({ success: false, message: err.message });
  }
};

// POST /api/attendance/check-out  { latitude?, longitude?, accuracy? }
exports.checkOut = async (req, res) => {
  try {
    const employeeId = req.user.id;
    const location = pickLocation(req.body);

    const { attendance, alreadyCheckedOut } = await upsertCheckOut({
      employeeId,
      when: new Date(),
      location,
    });

    return res.status(200).json({
      success: true,
      alreadyCheckedOut,
      attendance,
    });
  } catch (err) {
    console.error("attendance.checkOut:", err);
    return res.status(400).json({ success: false, message: err.message });
  }
};

// GET /api/attendance/today
exports.getToday = async (req, res) => {
  try {
    const attendance = await Attendance.findOne({
      employeeId: req.user.id,
      date: istDateKey(),
    }).populate(
      "sessionId",
      "status startTime endTime totalDistanceKm pointCount"
    );

    return res.json({ success: true, date: istDateKey(), attendance });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/attendance/my-history?from=&to=&page=&limit=
exports.getMyHistory = async (req, res) => {
  try {
    const { from, to, page = 1, limit = 30 } = req.query;
    const q = { employeeId: req.user.id };
    if (from || to) {
      q.date = {};
      if (from) q.date.$gte = from;
      if (to) q.date.$lte = to;
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [items, total] = await Promise.all([
      Attendance.find(q).sort({ date: -1 }).skip(skip).limit(parseInt(limit, 10)),
      Attendance.countDocuments(q),
    ]);

    return res.json({
      success: true,
      items,
      total,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / parseInt(limit, 10)),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/attendance/policy  (public to logged-in users)
exports.getPolicy = (req, res) => {
  return res.json({
    success: true,
    policy: {
      workStartHour: policy.workStartHour,
      workStartMinute: policy.workStartMinute,
      workEndHour: policy.workEndHour,
      workEndMinute: policy.workEndMinute,
      fullDayMinutes: policy.fullDayMinutes,
      halfDayMinutes: policy.halfDayMinutes,
      weeklyOffDays: policy.weeklyOffDays,
    },
  });
};

// ── Admin / Manager ────────────────────────────────────────────────────

// GET /api/attendance?date=&status=&role=&search=&page=&limit=
exports.listAttendance = async (req, res) => {
  try {
    const { date, status, role, search, page = 1, limit = 50 } = req.query;
    const user = req.user;

    let scopeIds = null;
    if (!ADMIN_LIKE_ROLES.includes(user.role)) {
      // Managers & Executives see themselves + everyone below.
      const subIds = await getSubordinateIds(user);
      scopeIds = [String(user.id), ...subIds];
    }

    const q = {};
    if (date) q.date = date;
    if (status) q.status = status;

    if (scopeIds) {
      q.employeeId = { $in: scopeIds.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    // Role filter — narrow down further
    if (role) {
      const users = await Register.find({ role }).select("_id");
      const ids = users.map((u) => u._id);
      q.employeeId = q.employeeId
        ? { $in: q.employeeId.$in.filter((id) => ids.some((i) => i.equals(id))) }
        : { $in: ids };
    }

    // Search — by name / mobile / email
    if (search && search.trim()) {
      const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const users = await Register.find({
        $or: [{ name: rx }, { mobile: rx }, { email: rx }],
      }).select("_id");
      const ids = users.map((u) => u._id);
      q.employeeId = q.employeeId
        ? { $in: q.employeeId.$in.filter((id) => ids.some((i) => i.equals(id))) }
        : { $in: ids };
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [items, total] = await Promise.all([
      Attendance.find(q)
        .populate("employeeId", "name email mobile role photo district taluk")
        .sort({ date: -1, checkInTime: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10)),
      Attendance.countDocuments(q),
    ]);

    return res.json({
      success: true,
      items,
      total,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / parseInt(limit, 10)),
    });
  } catch (err) {
    console.error("attendance.listAttendance:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/attendance/summary?date=YYYY-MM-DD
exports.getSummary = async (req, res) => {
  try {
    const date = req.query.date || istDateKey();

    const raw = await Attendance.aggregate([
      { $match: { date } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const summary = {
      PRESENT: 0,
      HALF_DAY: 0,
      ABSENT: 0,
      ON_LEAVE: 0,
      HOLIDAY: 0,
      WEEK_OFF: 0,
    };
    raw.forEach((r) => {
      // Old records saved as LATE are counted as a normal Full Day.
      const key = r._id === "LATE" ? "PRESENT" : r._id;
      if (key in summary) summary[key] += r.count;
    });

    const [workingNow, checkedOut] = await Promise.all([
      Attendance.countDocuments({
        date,
        checkInTime: { $ne: null },
        checkOutTime: null,
        status: { $in: ["PRESENT", "LATE"] },
      }),
      Attendance.countDocuments({
        date,
        checkOutTime: { $ne: null },
      }),
    ]);

    return res.json({ success: true, date, summary, workingNow, checkedOut });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/attendance/monthly?employeeId=&month=YYYY-MM
exports.getMonthly = async (req, res) => {
  try {
    const targetId = req.query.employeeId || req.user.id;
    if (!(await canManageAttendanceOf(req.user, targetId))) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const month = req.query.month || istDateKey().slice(0, 7);

    const items = await Attendance.find({
      employeeId: targetId,
      date: { $regex: `^${month}` },
    }).sort({ date: 1 });

    const summary = {
      workingDays: 0,
      present: 0,
      halfDay: 0,
      absent: 0,
      onLeave: 0,
      weekOff: 0,
      holiday: 0,
    };
    items.forEach((it) => {
      switch (it.status) {
        case "PRESENT":
        case "LATE": // legacy records → Full Day
          summary.present++;
          break;
        case "HALF_DAY": summary.halfDay++; break;
        case "ABSENT": summary.absent++; break;
        case "ON_LEAVE": summary.onLeave++; break;
        case "WEEK_OFF": summary.weekOff++; break;
        case "HOLIDAY": summary.holiday++; break;
      }
    });
    summary.workingDays =
      summary.present + summary.halfDay + summary.absent;

    const attendancePct = summary.workingDays
      ? Math.round(
          (((summary.present + summary.halfDay * 0.5) /
            summary.workingDays) *
            100) *
            100
        ) / 100
      : 0;

    return res.json({ success: true, month, items, summary, attendancePct });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/attendance/report?from=&to=&role=&search=&page=&limit=
exports.getReport = async (req, res) => {
  try {
    const { from, to, role, search, page = 1, limit = 100 } = req.query;
    const q = {};

    if (from || to) {
      q.date = {};
      if (from) q.date.$gte = from;
      if (to) q.date.$lte = to;
    }

    if (role) {
      const users = await Register.find({ role }).select("_id");
      q.employeeId = { $in: users.map((u) => u._id) };
    }

    if (search && search.trim()) {
      const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const users = await Register.find({
        $or: [{ name: rx }, { mobile: rx }],
      }).select("_id");
      q.employeeId = { $in: users.map((u) => u._id) };
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [items, total] = await Promise.all([
      Attendance.find(q)
        .populate("employeeId", "name role photo")
        .sort({ date: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10)),
      Attendance.countDocuments(q),
    ]);

    return res.json({
      success: true,
      items,
      total,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / parseInt(limit, 10)),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/attendance/:id   (Admin / HR correction)
exports.correctAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      checkInTime,
      checkOutTime,
      status,
      remarks,
      correctionReason,
    } = req.body;

    if (!ADMIN_LIKE_ROLES.includes(req.user.role)) {
      return res
        .status(403)
        .json({ success: false, message: "Only Admin can correct attendance" });
    }

    const attendance = await Attendance.findById(id);
    if (!attendance) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    if (checkInTime) attendance.checkInTime = new Date(checkInTime);
    if (checkOutTime) attendance.checkOutTime = new Date(checkOutTime);
    if (remarks !== undefined) attendance.remarks = remarks;

    if (attendance.checkInTime && attendance.checkOutTime) {
      const {
        computeStatusOnCheckOut,
      } = require("../services/attendanceService");
      const derived = computeStatusOnCheckOut(
        attendance.checkInTime,
        attendance.checkOutTime
      );
      attendance.workDurationMinutes = derived.workDurationMinutes;
      attendance.status = status || derived.status;
    } else if (status) {
      attendance.status = status;
    }

    attendance.correctedBy = req.user.id;
    attendance.correctionReason = correctionReason || "";

    await attendance.save();

    return res.json({ success: true, attendance });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

//-------------- 08.10.26 before change-----------------------
// const mongoose = require("mongoose");
// const Attendance = require("../models/Attendance/Attendance");
// const Register = require("../models/Register");
// const {
//   upsertCheckIn,
//   upsertCheckOut,
//   istDateKey,
// } = require("../services/attendanceService");
// const { canViewUser, getSubordinateIds } = require("../utils/hierarchyScope");
// const policy = require("../config/hrPolicy");

// // ── Helpers ────────────────────────────────────────────────────────────
// const pickLocation = (body) => {
//   if (!body) return null;
//   const lat = Number(body.latitude);
//   const lng = Number(body.longitude);
//   if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
//   return { latitude: lat, longitude: lng, accuracy: Number(body.accuracy) || 0 };
// };

// const ADMIN_LIKE_ROLES = ["Admin"];

// // Who can view WHOSE attendance. Mirrors hierarchyScope.canViewUser.
// async function canManageAttendanceOf(reqUser, targetUserId) {
//   if (ADMIN_LIKE_ROLES.includes(reqUser.role)) return true;
//   if (String(reqUser.id) === String(targetUserId)) return true;
//   return canViewUser(reqUser, targetUserId);
// }

// // ── Self-service ───────────────────────────────────────────────────────

// // POST /api/attendance/check-in   { latitude?, longitude?, accuracy? }
// exports.checkIn = async (req, res) => {
//   try {
//     const employeeId = req.user.id; // NEVER trust body
//     const location = pickLocation(req.body);

//     const { attendance, alreadyCheckedIn } = await upsertCheckIn({
//       employeeId,
//       when: new Date(),
//       location,
//     });

//     return res.status(alreadyCheckedIn ? 200 : 201).json({
//       success: true,
//       alreadyCheckedIn,
//       attendance,
//     });
//   } catch (err) {
//     console.error("attendance.checkIn:", err);
//     return res.status(400).json({ success: false, message: err.message });
//   }
// };

// // POST /api/attendance/check-out  { latitude?, longitude?, accuracy? }
// exports.checkOut = async (req, res) => {
//   try {
//     const employeeId = req.user.id;
//     const location = pickLocation(req.body);

//     const { attendance, alreadyCheckedOut } = await upsertCheckOut({
//       employeeId,
//       when: new Date(),
//       location,
//     });

//     return res.status(200).json({
//       success: true,
//       alreadyCheckedOut,
//       attendance,
//     });
//   } catch (err) {
//     console.error("attendance.checkOut:", err);
//     return res.status(400).json({ success: false, message: err.message });
//   }
// };

// // GET /api/attendance/today
// exports.getToday = async (req, res) => {
//   try {
//     const attendance = await Attendance.findOne({
//       employeeId: req.user.id,
//       date: istDateKey(),
//     }).populate(
//       "sessionId",
//       "status startTime endTime totalDistanceKm pointCount"
//     );

//     return res.json({ success: true, date: istDateKey(), attendance });
//   } catch (err) {
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// // GET /api/attendance/my-history?from=&to=&page=&limit=
// exports.getMyHistory = async (req, res) => {
//   try {
//     const { from, to, page = 1, limit = 30 } = req.query;
//     const q = { employeeId: req.user.id };
//     if (from || to) {
//       q.date = {};
//       if (from) q.date.$gte = from;
//       if (to) q.date.$lte = to;
//     }

//     const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
//     const [items, total] = await Promise.all([
//       Attendance.find(q).sort({ date: -1 }).skip(skip).limit(parseInt(limit, 10)),
//       Attendance.countDocuments(q),
//     ]);

//     return res.json({
//       success: true,
//       items,
//       total,
//       page: parseInt(page, 10),
//       totalPages: Math.ceil(total / parseInt(limit, 10)),
//     });
//   } catch (err) {
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// // GET /api/attendance/policy  (public to logged-in users)
// exports.getPolicy = (req, res) => {
//   return res.json({
//     success: true,
//     policy: {
//       workStartHour: policy.workStartHour,
//       workStartMinute: policy.workStartMinute,
//       workEndHour: policy.workEndHour,
//       workEndMinute: policy.workEndMinute,
//       lateGraceMinutes: policy.lateGraceMinutes,
//       fullDayMinutes: policy.fullDayMinutes,
//       halfDayMinutes: policy.halfDayMinutes,
//       weeklyOffDays: policy.weeklyOffDays,
//     },
//   });
// };

// // ── Admin / Manager ────────────────────────────────────────────────────

// // GET /api/attendance?date=&status=&role=&search=&page=&limit=
// exports.listAttendance = async (req, res) => {
//   try {
//     const { date, status, role, search, page = 1, limit = 50 } = req.query;
//     const user = req.user;

//     let scopeIds = null;
//     if (!ADMIN_LIKE_ROLES.includes(user.role)) {
//       // Managers & Executives see themselves + everyone below.
//       const subIds = await getSubordinateIds(user);
//       scopeIds = [String(user.id), ...subIds];
//     }

//     const q = {};
//     if (date) q.date = date;
//     if (status) q.status = status;

//     if (scopeIds) {
//       q.employeeId = { $in: scopeIds.map((id) => new mongoose.Types.ObjectId(id)) };
//     }

//     // Role filter — narrow down further
//     if (role) {
//       const users = await Register.find({ role }).select("_id");
//       const ids = users.map((u) => u._id);
//       q.employeeId = q.employeeId
//         ? { $in: q.employeeId.$in.filter((id) => ids.some((i) => i.equals(id))) }
//         : { $in: ids };
//     }

//     // Search — by name / mobile / email
//     if (search && search.trim()) {
//       const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
//       const users = await Register.find({
//         $or: [{ name: rx }, { mobile: rx }, { email: rx }],
//       }).select("_id");
//       const ids = users.map((u) => u._id);
//       q.employeeId = q.employeeId
//         ? { $in: q.employeeId.$in.filter((id) => ids.some((i) => i.equals(id))) }
//         : { $in: ids };
//     }

//     const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
//     const [items, total] = await Promise.all([
//       Attendance.find(q)
//         .populate("employeeId", "name email mobile role photo district taluk")
//         .sort({ date: -1, checkInTime: -1 })
//         .skip(skip)
//         .limit(parseInt(limit, 10)),
//       Attendance.countDocuments(q),
//     ]);

//     return res.json({
//       success: true,
//       items,
//       total,
//       page: parseInt(page, 10),
//       totalPages: Math.ceil(total / parseInt(limit, 10)),
//     });
//   } catch (err) {
//     console.error("attendance.listAttendance:", err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// // GET /api/attendance/summary?date=YYYY-MM-DD
// exports.getSummary = async (req, res) => {
//   try {
//     const date = req.query.date || istDateKey();

//     const raw = await Attendance.aggregate([
//       { $match: { date } },
//       { $group: { _id: "$status", count: { $sum: 1 } } },
//     ]);

//     const summary = {
//       PRESENT: 0,
//       LATE: 0,
//       HALF_DAY: 0,
//       ABSENT: 0,
//       ON_LEAVE: 0,
//       HOLIDAY: 0,
//       WEEK_OFF: 0,
//     };
//     raw.forEach((r) => {
//       if (r._id in summary) summary[r._id] = r.count;
//     });

//     const [workingNow, checkedOut] = await Promise.all([
//       Attendance.countDocuments({
//         date,
//         checkInTime: { $ne: null },
//         checkOutTime: null,
//         status: { $in: ["PRESENT", "LATE"] },
//       }),
//       Attendance.countDocuments({
//         date,
//         checkOutTime: { $ne: null },
//       }),
//     ]);

//     return res.json({ success: true, date, summary, workingNow, checkedOut });
//   } catch (err) {
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// // GET /api/attendance/monthly?employeeId=&month=YYYY-MM
// exports.getMonthly = async (req, res) => {
//   try {
//     const targetId = req.query.employeeId || req.user.id;
//     if (!(await canManageAttendanceOf(req.user, targetId))) {
//       return res.status(403).json({ success: false, message: "Not authorized" });
//     }

//     const month = req.query.month || istDateKey().slice(0, 7);

//     const items = await Attendance.find({
//       employeeId: targetId,
//       date: { $regex: `^${month}` },
//     }).sort({ date: 1 });

//     const summary = {
//       workingDays: 0,
//       present: 0,
//       late: 0,
//       halfDay: 0,
//       absent: 0,
//       onLeave: 0,
//       weekOff: 0,
//       holiday: 0,
//     };
//     items.forEach((it) => {
//       switch (it.status) {
//         case "PRESENT": summary.present++; break;
//         case "LATE": summary.late++; break;
//         case "HALF_DAY": summary.halfDay++; break;
//         case "ABSENT": summary.absent++; break;
//         case "ON_LEAVE": summary.onLeave++; break;
//         case "WEEK_OFF": summary.weekOff++; break;
//         case "HOLIDAY": summary.holiday++; break;
//       }
//     });
//     summary.workingDays =
//       summary.present + summary.late + summary.halfDay + summary.absent;

//     const attendancePct = summary.workingDays
//       ? Math.round(
//           (((summary.present + summary.late + summary.halfDay * 0.5) /
//             summary.workingDays) *
//             100) *
//             100
//         ) / 100
//       : 0;

//     return res.json({ success: true, month, items, summary, attendancePct });
//   } catch (err) {
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// // GET /api/attendance/report?from=&to=&role=&search=&page=&limit=
// exports.getReport = async (req, res) => {
//   try {
//     const { from, to, role, search, page = 1, limit = 100 } = req.query;
//     const q = {};

//     if (from || to) {
//       q.date = {};
//       if (from) q.date.$gte = from;
//       if (to) q.date.$lte = to;
//     }

//     if (role) {
//       const users = await Register.find({ role }).select("_id");
//       q.employeeId = { $in: users.map((u) => u._id) };
//     }

//     if (search && search.trim()) {
//       const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
//       const users = await Register.find({
//         $or: [{ name: rx }, { mobile: rx }],
//       }).select("_id");
//       q.employeeId = { $in: users.map((u) => u._id) };
//     }

//     const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
//     const [items, total] = await Promise.all([
//       Attendance.find(q)
//         .populate("employeeId", "name role photo")
//         .sort({ date: -1 })
//         .skip(skip)
//         .limit(parseInt(limit, 10)),
//       Attendance.countDocuments(q),
//     ]);

//     return res.json({
//       success: true,
//       items,
//       total,
//       page: parseInt(page, 10),
//       totalPages: Math.ceil(total / parseInt(limit, 10)),
//     });
//   } catch (err) {
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// // PUT /api/attendance/:id   (Admin / HR correction)
// exports.correctAttendance = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const {
//       checkInTime,
//       checkOutTime,
//       status,
//       remarks,
//       correctionReason,
//     } = req.body;

//     if (!ADMIN_LIKE_ROLES.includes(req.user.role)) {
//       return res
//         .status(403)
//         .json({ success: false, message: "Only Admin can correct attendance" });
//     }

//     const attendance = await Attendance.findById(id);
//     if (!attendance) {
//       return res.status(404).json({ success: false, message: "Not found" });
//     }

//     if (checkInTime) attendance.checkInTime = new Date(checkInTime);
//     if (checkOutTime) attendance.checkOutTime = new Date(checkOutTime);
//     if (remarks !== undefined) attendance.remarks = remarks;

//     if (attendance.checkInTime && attendance.checkOutTime) {
//       const {
//         computeStatusOnCheckOut,
//       } = require("../services/attendanceService");
//       const derived = computeStatusOnCheckOut(
//         attendance.checkInTime,
//         attendance.checkOutTime
//       );
//       attendance.workDurationMinutes = derived.workDurationMinutes;
//       attendance.status = status || derived.status;
//     } else if (status) {
//       attendance.status = status;
//     }

//     attendance.correctedBy = req.user.id;
//     attendance.correctionReason = correctionReason || "";

//     await attendance.save();

//     return res.json({ success: true, attendance });
//   } catch (err) {
//     return res.status(400).json({ success: false, message: err.message });
//   }
// };