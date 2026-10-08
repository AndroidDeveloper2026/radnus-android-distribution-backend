const Attendance = require("../models/Attendance/Attendance");
const policy = require("../config/hrPolicy");

// ── IST helpers ────────────────────────────────────────────────────────
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDateKey(d = new Date()) {
  const shifted = new Date(new Date(d).getTime() + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isWeeklyOff(dateKey) {
  // We parse the "YYYY-MM-DD" as if it were local, purely to read its
  // weekday. Since we already converted to IST date parts, this is safe.
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return policy.weeklyOffDays.includes(dt.getUTCDay());
}

// ── Time-of-day helpers ────────────────────────────────────────────────
function istTimeParts(date) {
  const shifted = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  return {
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dateKey: istDateKey(date),
  };
}

// There is no "late" concept: a check-in is simply the start of a working
// day (PRESENT while the day is running). The final day type — Full Day
// (PRESENT) or HALF_DAY — is decided from the hours worked at check-out.
function computeStatusOnCheckIn() {
  return { status: "PRESENT" };
}

function computeStatusOnCheckOut(checkInTime, checkOutTime) {
  const minutes = Math.max(
    0,
    Math.round((new Date(checkOutTime) - new Date(checkInTime)) / 60000)
  );

  let status;
  if (minutes < policy.halfDayMinutes) {
    status = "ABSENT"; // worked less than a half day
  } else if (minutes < policy.fullDayMinutes) {
    status = "HALF_DAY";
  } else {
    status = "PRESENT"; // Full Day
  }

  return { workDurationMinutes: minutes, status };
}

// ── Core upserts (idempotent) ──────────────────────────────────────────

// Called by:
//   • POST /api/attendance/check-in   (normal employee)
//   • POST /api/session/start          (FSE — automatically)
// Returns { attendance, alreadyCheckedIn }
async function upsertCheckIn({
  employeeId,
  when = new Date(),
  location = null,
  sessionId = null,
}) {
  const date = istDateKey(when);

  // Weekly off → record it but do NOT require a check-in to be meaningful.
  // If an employee checks in on their weekly off, we still record the
  // check-in (staff sometimes works weekends); status will fall through
  // to the normal PRESENT / HALF_DAY logic.
  const existing = await Attendance.findOne({ employeeId, date });

  if (existing && existing.checkInTime) {
    // Idempotent: a second check-in does not overwrite the first.
    return { attendance: existing, alreadyCheckedIn: true };
  }

  const { status } = computeStatusOnCheckIn(when);

  if (existing) {
    // This branch fires when cron has already marked the employee ABSENT
    // (e.g. an FSE who starts their day after 23:55 — rare, but possible),
    // or when they're correcting a previous state.
    existing.checkInTime = when;
    existing.checkInLocation = location || existing.checkInLocation || undefined;
    existing.status = status;
    if (sessionId) existing.sessionId = sessionId;
    existing.remarks = (existing.remarks || "") + " | Check-in recorded";
    await existing.save();
    return { attendance: existing, alreadyCheckedIn: false };
  }

  const created = await Attendance.create({
    employeeId,
    date,
    checkInTime: when,
    checkInLocation: location || undefined,
    status,
    sessionId: sessionId || null,
  });

  return { attendance: created, alreadyCheckedIn: false };
}

// Called by:
//   • POST /api/attendance/check-out   (normal employee)
//   • POST /api/session/end             (FSE — automatically)
async function upsertCheckOut({ employeeId, when = new Date(), location = null }) {
  const date = istDateKey(when);
  const attendance = await Attendance.findOne({ employeeId, date });

  if (!attendance) {
    throw new Error("No check-in found for today");
  }
  if (attendance.checkOutTime) {
    return { attendance, alreadyCheckedOut: true };
  }
  if (!attendance.checkInTime) {
    throw new Error("Attendance record has no check-in time");
  }

  const { workDurationMinutes, status } = computeStatusOnCheckOut(
    attendance.checkInTime,
    when
  );

  attendance.checkOutTime = when;
  attendance.checkOutLocation = location || undefined;
  attendance.workDurationMinutes = workDurationMinutes;
  attendance.status = status;
  await attendance.save();

  return { attendance, alreadyCheckedOut: false };
}

async function getToday(employeeId) {
  return Attendance.findOne({ employeeId, date: istDateKey() });
}

module.exports = {
  istDateKey,
  isWeeklyOff,
  computeStatusOnCheckIn,
  computeStatusOnCheckOut,
  upsertCheckIn,
  upsertCheckOut,
  getToday,
};

//------------ 08.10.26 before change --------------------
// const Attendance = require("../models/Attendance/Attendance");
// const policy = require("../config/hrPolicy");

// // ── IST helpers ────────────────────────────────────────────────────────
// const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// function istDateKey(d = new Date()) {
//   const shifted = new Date(new Date(d).getTime() + IST_OFFSET_MS);
//   const y = shifted.getUTCFullYear();
//   const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
//   const day = String(shifted.getUTCDate()).padStart(2, "0");
//   return `${y}-${m}-${day}`;
// }

// function isWeeklyOff(dateKey) {
//   // We parse the "YYYY-MM-DD" as if it were local, purely to read its
//   // weekday. Since we already converted to IST date parts, this is safe.
//   const [y, m, d] = dateKey.split("-").map(Number);
//   const dt = new Date(Date.UTC(y, m - 1, d));
//   return policy.weeklyOffDays.includes(dt.getUTCDay());
// }

// // ── Time-of-day helpers ────────────────────────────────────────────────
// function istTimeParts(date) {
//   const shifted = new Date(new Date(date).getTime() + IST_OFFSET_MS);
//   return {
//     hour: shifted.getUTCHours(),
//     minute: shifted.getUTCMinutes(),
//     dateKey: istDateKey(date),
//   };
// }

// function computeLateMinutes(checkInTime) {
//   const { hour, minute } = istTimeParts(checkInTime);
//   const grace =
//     policy.workStartHour * 60 + policy.workStartMinute + policy.lateGraceMinutes;
//   const actual = hour * 60 + minute;
//   return actual > grace ? actual - grace : 0;
// }

// function computeStatusOnCheckIn(checkInTime) {
//   const lateMinutes = computeLateMinutes(checkInTime);
//   return {
//     status: lateMinutes > 0 ? "LATE" : "PRESENT",
//     lateMinutes,
//   };
// }

// function computeStatusOnCheckOut(checkInTime, checkOutTime) {
//   const minutes = Math.max(
//     0,
//     Math.round((new Date(checkOutTime) - new Date(checkInTime)) / 60000)
//   );

//   // Duration thresholds take priority over late/on-time, because an
//   // employee who leaves early should not still be shown as PRESENT.
//   let status;
//   if (minutes < policy.halfDayMinutes) {
//     status = "ABSENT";
//   } else if (minutes < policy.fullDayMinutes) {
//     status = "HALF_DAY";
//   } else {
//     const { lateMinutes } = computeStatusOnCheckIn(checkInTime);
//     status = lateMinutes > 0 ? "LATE" : "PRESENT";
//   }

//   return { workDurationMinutes: minutes, status };
// }

// // ── Core upserts (idempotent) ──────────────────────────────────────────

// // Called by:
// //   • POST /api/attendance/check-in   (normal employee)
// //   • POST /api/session/start          (FSE — automatically)
// // Returns { attendance, alreadyCheckedIn }
// async function upsertCheckIn({
//   employeeId,
//   when = new Date(),
//   location = null,
//   sessionId = null,
// }) {
//   const date = istDateKey(when);

//   // Weekly off → record it but do NOT require a check-in to be meaningful.
//   // If an employee checks in on their weekly off, we still record the
//   // check-in (staff sometimes works weekends); status will fall through
//   // to the normal PRESENT/LATE logic.
//   const existing = await Attendance.findOne({ employeeId, date });

//   if (existing && existing.checkInTime) {
//     // Idempotent: a second check-in does not overwrite the first.
//     return { attendance: existing, alreadyCheckedIn: true };
//   }

//   const { status, lateMinutes } = computeStatusOnCheckIn(when);

//   if (existing) {
//     // This branch fires when cron has already marked the employee ABSENT
//     // (e.g. an FSE who starts their day after 23:55 — rare, but possible),
//     // or when they're correcting a previous state.
//     existing.checkInTime = when;
//     existing.checkInLocation = location || existing.checkInLocation || undefined;
//     existing.status = status;
//     existing.lateMinutes = lateMinutes;
//     if (sessionId) existing.sessionId = sessionId;
//     existing.remarks = (existing.remarks || "") + " | Check-in recorded";
//     await existing.save();
//     return { attendance: existing, alreadyCheckedIn: false };
//   }

//   const created = await Attendance.create({
//     employeeId,
//     date,
//     checkInTime: when,
//     checkInLocation: location || undefined,
//     status,
//     lateMinutes,
//     sessionId: sessionId || null,
//   });

//   return { attendance: created, alreadyCheckedIn: false };
// }

// // Called by:
// //   • POST /api/attendance/check-out   (normal employee)
// //   • POST /api/session/end             (FSE — automatically)
// async function upsertCheckOut({ employeeId, when = new Date(), location = null }) {
//   const date = istDateKey(when);
//   const attendance = await Attendance.findOne({ employeeId, date });

//   if (!attendance) {
//     throw new Error("No check-in found for today");
//   }
//   if (attendance.checkOutTime) {
//     return { attendance, alreadyCheckedOut: true };
//   }
//   if (!attendance.checkInTime) {
//     throw new Error("Attendance record has no check-in time");
//   }

//   const { workDurationMinutes, status } = computeStatusOnCheckOut(
//     attendance.checkInTime,
//     when
//   );

//   attendance.checkOutTime = when;
//   attendance.checkOutLocation = location || undefined;
//   attendance.workDurationMinutes = workDurationMinutes;
//   attendance.status = status;
//   await attendance.save();

//   return { attendance, alreadyCheckedOut: false };
// }

// async function getToday(employeeId) {
//   return Attendance.findOne({ employeeId, date: istDateKey() });
// }

// module.exports = {
//   istDateKey,
//   isWeeklyOff,
//   computeLateMinutes,
//   computeStatusOnCheckIn,
//   computeStatusOnCheckOut,
//   upsertCheckIn,
//   upsertCheckOut,
//   getToday,
// };