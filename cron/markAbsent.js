const cron = require("node-cron");
const Attendance = require("../models/Attendance/Attendance");
const Register = require("../models/Register");
const policy = require("../config/hrPolicy");
const {
  istDateKey,
  isWeeklyOff,
} = require("../services/attendanceService");

// ─────────────────────────────────────────────────────────────────────
// markAbsent()
//
// Runs once per day (default 23:55 IST) and creates ABSENT attendance
// for every internal employee who:
//    • did not check in today
//    • is not already marked (any status) for today
//
// Holiday / Approved-Leave support: this is the ONE place to hook in
// a Holiday or LeaveRequest model when those features exist. Today
// (v1) the code just checks the weekly-off calendar.
// ─────────────────────────────────────────────────────────────────────
async function markAbsent() {
  const today = istDateKey();

  // 1. Weekly off → do nothing for this whole day.
  if (isWeeklyOff(today)) {
    console.log(`[markAbsent] ${today} is a weekly off — nothing to mark`);
    return;
  }

  // 2. Which internal employees should have attendance?
  const employees = await Register.find({
    role: { $in: policy.attendanceRoles },
    isApproved: true,
    isActive: { $ne: false },
  }).select("_id");

  // 3. Who already has a record today?
  const existing = await Attendance.find({ date: today }).select("employeeId");
  const have = new Set(existing.map((a) => String(a.employeeId)));

  // ─── EXTENSION POINT ─────────────────────────────────────────────
  // When a Holiday / LeaveRequest model is added, filter them out here:
  //   const holidayUserIds = await Holiday.…;
  //   const onLeaveUserIds = await LeaveRequest.…;
  // and mark those employees ON_LEAVE / HOLIDAY instead of ABSENT.
  // ─────────────────────────────────────────────────────────────────

  const toCreate = employees
    .filter((e) => !have.has(String(e._id)))
    .map((e) => ({
      employeeId: e._id,
      date: today,
      status: "ABSENT",
      remarks: "Auto-marked absent (no check-in)",
    }));

  if (!toCreate.length) {
    console.log(`[markAbsent] ${today}: everyone already has attendance`);
    return;
  }

  try {
    await Attendance.insertMany(toCreate, { ordered: false });
    console.log(`[markAbsent] ${today}: created ${toCreate.length} ABSENT records`);
  } catch (e) {
    // Ordered:false means duplicates don't kill the batch — we only
    // surface genuinely unexpected errors.
    if (e.code !== 11000 && !Array.isArray(e.writeErrors)) {
      console.error("[markAbsent] insert error:", e.message);
    }
  }
}

function start() {
  const expr = `${policy.absentMarkingMinute} ${policy.absentMarkingHour} * * *`;
  cron.schedule(expr, markAbsent, { timezone: "Asia/Kolkata" });
  console.log(`[markAbsent] scheduled at ${expr} IST`);
}

module.exports = { start, markAbsent };