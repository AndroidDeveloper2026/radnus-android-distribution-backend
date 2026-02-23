const express = require("express");
const router = express.Router();
const { register, login, verifyOtp, resendOtp, forgotPassword,verifyResetOtp, resetPassword} = require("../controllers/authController");
const auth = require("../middleware/authMiddleware");
// const { isAdmin } = require("../middleware/roleMiddleware");

router.post("/register", register);
router.post("/login", login);

// ✅ OTP ROUTES
router.post("/verify-otp", verifyOtp);
router.post("/resend-otp", resendOtp);

router.post("/forgot-password", forgotPassword);
router.post("/verify-reset-otp", verifyResetOtp);
router.post("/reset-password", resetPassword);

// Protected route
router.get("/profile", auth, (req, res) => {
  res.json({ msg: "User profile", user: req.user });
});



module.exports = router;
