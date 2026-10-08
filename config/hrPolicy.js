// All HR business rules live here — never hardcoded inside controllers.
// Change these values to shift the entire attendance system's behavior
// without touching any controller or service code.

module.exports = {
  // ── Shift window (IST, 24h format) ─────────────────────────────────
  workStartHour: 9,
  workStartMinute: 30,
  workEndHour: 18,
  workEndMinute: 30,

  // ── Day type (no "late" concept) ───────────────────────────────────
  // A day's status is decided ONLY by how long the employee worked,
  // when they check out / end their day. Check-in time does not matter.
  //   worked >= fullDayMinutes                  → PRESENT (Full Day)
  //   halfDayMinutes <= worked < fullDayMinutes → HALF_DAY
  //   worked < halfDayMinutes                   → ABSENT
  fullDayMinutes: 8 * 60,   // >= 480 → PRESENT (Full Day)
  halfDayMinutes: 4 * 60,   // >= 240 → HALF_DAY ; < 240 → ABSENT

  // ── Weekly off ─────────────────────────────────────────────────────
  // 0 = Sunday. Add more (e.g. [0, 6]) for Sat+Sun off.
  weeklyOffDays: [0],

  // ── Absent-marking cron ────────────────────────────────────────────
  absentMarkingHour: 23,
  absentMarkingMinute: 55,

  // ── Which roles get attendance ─────────────────────────────────────
  // FSE attendance is created automatically by START DAY.
  // The rest use the normal Check-In / Check-Out screen.
  // Distributor/Retailer are business partners, not internal employees,
  // so they are excluded.
  attendanceRoles: [
    "Admin",
    "Radnus",
    "MarketingManager",
    "MarketingExecutive",
    "Distributor",
    "FSE",
  ],
};

//----------- 08.10.26 Before change ----------------
// // All HR business rules live here — never hardcoded inside controllers.
// // Change these values to shift the entire attendance system's behavior
// // without touching any controller or service code.

// module.exports = {
//   // ── Shift window (IST, 24h format) ─────────────────────────────────
//   workStartHour: 9,
//   workStartMinute: 30,
//   workEndHour: 18,
//   workEndMinute: 30,

//   // ── Late rule ──────────────────────────────────────────────────────
//   // Minutes after workStartTime at which we START counting as LATE.
//   // 0 = any check-in after 09:30 is LATE.
//   lateGraceMinutes: 0,

//   // ── Duration thresholds (minutes) ──────────────────────────────────
//   // A day's status is DERIVED from working minutes when the employee
//   // checks out (early check-out can downgrade PRESENT → HALF_DAY →
//   // ABSENT regardless of when they checked in).
//   fullDayMinutes: 8 * 60,   // >= 480 → PRESENT / LATE
//   halfDayMinutes: 4 * 60,   // >= 240 → HALF_DAY ; < 240 → ABSENT

//   // ── Weekly off ─────────────────────────────────────────────────────
//   // 0 = Sunday. Add more (e.g. [0, 6]) for Sat+Sun off.
//   weeklyOffDays: [0],

//   // ── Absent-marking cron ────────────────────────────────────────────
//   absentMarkingHour: 23,
//   absentMarkingMinute: 55,

//   // ── Which roles get attendance ─────────────────────────────────────
//   // FSE attendance is created automatically by START DAY.
//   // The rest use the normal Check-In / Check-Out screen.
//   // Distributor/Retailer are business partners, not internal employees,
//   // so they are excluded.
//   attendanceRoles: [
//     "Admin",
//     "Radnus",
//     "MarketingManager",
//     "MarketingExecutive",
//     "Distributor",
//     "FSE",
//   ],
// };