const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Register = require("../models/Register");
const User = require("../models/User");
const admin = require("../config/firebaseAdmin");

//OTP verify
exports.verifyOtp = async (req, res) => {
  const { mobile, otp } = req.body;

  const user = await Register.findOne({ mobile });

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  if (user.otp !== otp) {
    return res.status(400).json({ message: "Invalid OTP" });
  }

  if (user.otpExpiry < Date.now()) {
    return res.status(400).json({ message: "OTP expired" });
  }

  user.otp = null;
  user.otpExpiry = null;

  await user.save();

  res.json({ message: "OTP verified successfully" });
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
      token:fcmToken,
      notification:{
        title:"OTP Verification",
        body:`your OTP is ${otp}`,
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

// LOGIN
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: "Invalid credentials" });

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
