const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const ctrl = require("../controllers/attendanceController");

router.use(auth); // JWT required for every attendance route

// ── Self service ───────────────────────────────────────────────────────
router.post("/check-in", ctrl.checkIn);
router.post("/check-out", ctrl.checkOut);
router.get("/today", ctrl.getToday);
router.get("/my-history", ctrl.getMyHistory);
router.get("/policy", ctrl.getPolicy);

// ── Admin / Manager ────────────────────────────────────────────────────
router.get("/", ctrl.listAttendance);
router.get("/summary", ctrl.getSummary);
router.get("/report", ctrl.getReport);
router.get("/monthly", ctrl.getMonthly);
router.put("/:id", ctrl.correctAttendance);

module.exports = router;