const express = require("express");
const router = express.Router();
const { register, login, verifyOtp, resendOtp } = require("../controllers/authController");
const auth = require("../middleware/authMiddleware");
// const { isAdmin } = require("../middleware/roleMiddleware");

router.post("/register", register);
router.post("/login", login);

// ✅ OTP ROUTES
router.post("/verify-otp", verifyOtp);
router.post("/resend-otp", resendOtp);

// Protected route
router.get("/profile", auth, (req, res) => {
  res.json({ msg: "User profile", user: req.user });
});

// Admin only
// router.get("/admin", auth, isAdmin, (req, res) => {
//   res.json({ msg: "Welcome Admin" });
// });

module.exports = router;
