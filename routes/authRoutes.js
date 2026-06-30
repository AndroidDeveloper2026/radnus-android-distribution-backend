// routes/authRoutes.js
const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const auth = require("../middleware/authMiddleware");
const Register = require("../models/Register");

// AUTH
router.post("/register", authController.register);
router.post("/login", authController.login);
router.get("/eligible-parents", authController.getEligibleParents);

// OTP
router.post("/verify-otp", authController.verifyOtp);
router.post("/resend-otp", authController.resendOtp);

// PASSWORD RESET
router.post("/forgot-password", authController.forgotPassword);
router.post("/verify-reset-otp", authController.verifyResetOtp);
router.post("/reset-password", authController.resetPassword);

// ADMIN LOGIN
router.post('/admin', authController.adminLogin);

// TOKEN REFRESH
router.post("/refresh", authController.refreshToken);

// PROTECTED ROUTES
router.get("/profile", auth, (req, res) => {
  res.json({
    msg: "User profile",
    user: req.user,
  });
});

router.get('/me', auth, async (req, res) => {
  try {
    const user = await Register.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get user's approval status
router.get('/approval-status', auth, async (req, res) => {
  try {
    const user = await Register.findById(req.user.id)
      .select('approvalStatus isApproved rejectionReason role name email');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      approvalStatus: user.approvalStatus,
      isApproved: user.isApproved,
      role: user.role,
      name: user.name,
      email: user.email,
      rejectionReason: user.rejectionReason || null
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

//+++++++++++++++++++++++++++++++
// // routes/authRoutes.js
// const express = require("express");
// const router = express.Router();
// const authController = require("../controllers/authController");
// const auth = require("../middleware/authMiddleware");
// const Register = require("../models/Register");

// // AUTH
// router.post("/register", authController.register);
// router.post("/login", authController.login);

// // OTP
// router.post("/verify-otp", authController.verifyOtp);
// router.post("/resend-otp", authController.resendOtp);

// // PASSWORD RESET
// router.post("/forgot-password", authController.forgotPassword);
// router.post("/verify-reset-otp", authController.verifyResetOtp);
// router.post("/reset-password", authController.resetPassword);

// // ADMIN LOGIN
// router.post('/admin', authController.adminLogin);

// // TOKEN REFRESH
// router.post("/refresh", authController.refreshToken);

// // PROTECTED ROUTES
// router.get("/profile", auth, (req, res) => {
//   res.json({
//     msg: "User profile",
//     user: req.user,
//   });
// });

// router.get('/me', auth, async (req, res) => {
//   try {
//     const user = await Register.findById(req.user.id).select('-password');
//     if (!user) {
//       return res.status(404).json({ message: 'User not found' });
//     }
//     res.json({ user });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// });

// // Get user's approval status
// router.get('/approval-status', auth, async (req, res) => {
//   try {
//     const user = await Register.findById(req.user.id)
//       .select('approvalStatus isApproved rejectionReason role name email');
    
//     if (!user) {
//       return res.status(404).json({ message: 'User not found' });
//     }

//     res.json({
//       approvalStatus: user.approvalStatus,
//       isApproved: user.isApproved,
//       role: user.role,
//       name: user.name,
//       email: user.email,
//       rejectionReason: user.rejectionReason || null
//     });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// });

// module.exports = router;

