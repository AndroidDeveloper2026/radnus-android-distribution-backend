const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Register = require("../models/Register");
const User = require("../models/User");
const admin = require("../config/firebaseAdmin");

//OTP verify
// exports.verifyOtp = async (req, res) => {
//   const { mobile, otp } = req.body;

//   const user = await Register.findOne({ mobile });

//   if (!user) {
//     return res.status(404).json({ message: "User not found" });
//   }

//   if (user.otp !== otp) {
//     return res.status(400).json({ message: "Invalid OTP" });
//   }

//   if (user.otpExpiry < Date.now()) {
//     return res.status(400).json({ message: "OTP expired" });
//   }

//   user.otp = null;
//   user.otpExpiry = null;

//   await user.save();

//   res.json({ message: "OTP verified successfully" });
// };

//OTP verify
// exports.verifyOtp = async (req, res) => {
//   let { mobile, otp } = req.body;

//  console.log("DB OTP:", `"${otp}"`);
//   console.log("DB mobile :", `"${mobile}"`);

//   // 🔥 NORMALIZE
//   otp = otp.toString().trim();
//  console.log("DB OTP trim:", `"${otp}"`)
//   const user = await Register.findOne({ mobile });

//   if (!user) {
//     return res.status(404).json({
//       success: false,
//       message: "User not found",
//     });
//   }

//   console.log("REQ OTP:", `"${otp}"`);
//   console.log("DB OTP :", `"${user.otp}"`);

//   if (!user.otp || user.otp.toString().trim() !== otp) {
//     return res.status(400).json({
//       success: false,
//       message: "Invalid OTP",
//     });
//   }

//   if (user.otpExpiry < Date.now()) {
//     return res.status(400).json({
//       success: false,
//       message: "OTP expired",
//     });
//   }

//   user.isVerified = true;
//   user.otp = null;
//   user.otpExpiry = null;

//   await user.save();

//   return res.json({
//     success: true,
//     message: "OTP verified successfully",
//   });
// };

exports.verifyOtp = async (req, res) => {
  try {
    let { mobile, otp } = req.body;

    if (!mobile || !otp) {
      return res.status(200).json({
        success: false,
        message: "Mobile and OTP are required",
      });
    }

    mobile = mobile.toString().trim();
    otp = otp.toString().trim();

    const user = await Register.findOne({ mobile });

    if (!user) {
      return res.status(200).json({
        success: false,
        message: "User not found",
      });
    }

    // ⚠️ SAFE expiry check
    if (!user.otpExpiry || Number(user.otpExpiry) < Date.now()) {
      return res.status(200).json({
        success: false,
        message: "OTP expired",
      });
    }

    // ⚠️ SAFE OTP check
    if (!user.otp || user.otp.toString().trim() !== otp) {
      console.log("DB OTP:", user.otp, "REQ OTP:", otp);
      return res.status(200).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    user.isVerified = true;
    user.otp = null;
    user.otpExpiry = null;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
    });

  } catch (err) {
    console.error("VERIFY OTP SERVER ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};



exports.resendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;

    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: "Mobile number is required",
      });
    }

    const user = await Register.findOne({ mobile });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 🔐 Generate NEW OTP
    const otp = user.generateOtp();
    await user.save();

    // 🔔 Send FCM notification ONLY if token exists
    if (user.fcmToken) {
      try {
        await admin.messaging().send({
          token: user.fcmToken,
          notification: {
            title: "OTP Verification",
            body: `Your OTP is ${otp}`,
          },
        });
      } catch (fcmError) {
        console.error("FCM ERROR (ignored):", fcmError.message);
        // ❗ Do NOT fail OTP resend because of FCM
      }
    }

    return res.status(200).json({
      success: true,
      message: "OTP resent successfully",
    });
  } catch (error) {
    console.error("RESEND OTP ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while resending OTP",
    });
  }
};

//register
exports.register = async (req, res) => {
  console.log("--- req body --->", req.body);
  try {
    const {
      role,
      state,
      district,
      taluk,
      name,
      email,
      mobile,
      password,
      confirmPassword,
      fcmToken,
    } = req.body;

    if (!fcmToken) {
      return res.status(400).json({ message: "FCM token required" });
    }

    // 🔍 Validation
    if (
      !role ||
      !state ||
      !district ||
      !taluk ||
      !name ||
      !email ||
      !mobile ||
      !password
    ) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    // 📱 Check mobile already exists
    const existingUser = await Register.findOne({ mobile });
    if (existingUser) {
      return res
        .status(409)
        .json({ message: "Mobile number already registered" });
    }

    // 💾 Save user
    const user = new Register({
      role,
      state,
      district,
      taluk,
      name,
      email,
      mobile,
      password,
      fcmToken,
    });

    const otp = user.generateOtp();

    await user.save();

    // send push notification
    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title: "OTP Verification",
        body: `your OTP is ${otp}`,
      },
    });

    res.status(201).json({
      message: "Registration successful. OTP sent",
      userId: user._id,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.login = async (req, res) => {
  // console.log('--- LOGIN BODY:----', req.body);

  const { email, password } = req.body;

  try {
    const user = await Register.findOne({ email });

    if (!user) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
