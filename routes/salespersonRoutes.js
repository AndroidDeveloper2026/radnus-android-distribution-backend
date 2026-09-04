const express = require("express");
const router = express.Router();
const {
  getSalespersons,
  addSalesperson,
  deleteSalesperson,
  updateSalesperson,
} = require("../controllers/salespersonController");

// ─── Auth Middleware ──────────────────────────────────────────────────
// Try to import auth middleware, fallback if not found
let protect;
try {
  const authMiddleware = require("../middleware/authMiddleware");
  protect = authMiddleware.protect || authMiddleware;
} catch (e) {
  // Fallback middleware - replace with your actual auth logic
  console.warn("⚠️ Auth middleware not found, using fallback");
  protect = (req, res, next) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ msg: "No token, authorization denied" });
    }
    // For testing - pass through
    req.user = { name: "system" };
    next();
  };
}

// ─── Apply auth to all routes ────────────────────────────────────────
router.use(protect);

// ─── Routes ──────────────────────────────────────────────────────────
router.get("/", getSalespersons);
router.post("/", addSalesperson);
router.delete("/:id", deleteSalesperson);
router.put("/:id", updateSalesperson);

module.exports = router;