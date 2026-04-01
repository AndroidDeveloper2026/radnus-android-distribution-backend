// const express = require("express");
// const router = express.Router();
// const { register, login, verifyOtp, resendOtp, forgotPassword,verifyResetOtp, resetPassword} = require("../controllers/authController");
// const auth = require("../middleware/authMiddleware");
// // const { isAdmin } = require("../middleware/roleMiddleware");

// router.post("/register", register);
// router.post("/login", login);

// // ✅ OTP ROUTES
// router.post("/verify-otp", verifyOtp);
// router.post("/resend-otp", resendOtp);

// router.post("/forgot-password", forgotPassword);
// router.post("/verify-reset-otp", verifyResetOtp);
// router.post("/reset-password", resetPassword);

// // Protected route
// router.get("/profile", auth, (req, res) => {
//   res.json({ msg: "User profile", user: req.user });
// });



// module.exports = router;


const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const authController = require("../controllers/authController");
const auth = require("../middleware/authMiddleware");

// AUTH
router.post("/register", authController.register);
router.post("/login", authController.login);

// OTP
router.post("/verify-otp", authController.verifyOtp);
router.post("/resend-otp", authController.resendOtp);

// PASSWORD RESET
router.post("/forgot-password", authController.forgotPassword);
router.post("/verify-reset-otp", authController.verifyResetOtp);
router.post("/reset-password", authController.resetPassword);
// In your auth routes file
router.post('/admin', authController.adminLogin); // → /api/auth/admin

// PROTECTED ROUTE
router.get("/profile", auth, (req, res) => {
  res.json({
    msg: "User profile",
    user: req.user,
  });
});

router.post("/refresh", authController.refreshToken);


module.exports = router;