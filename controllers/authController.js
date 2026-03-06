const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Register = require("../models/Register");
const admin = require("../config/firebaseAdmin");
const transporter = require("../config/mailer");

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    const user = await Register.findOne({ email });

    // if (!user) {
    //   return res.json({
    //     success: true,
    //     message: "If email exists, OTP sent",
    //   });
    // }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Email not registered",
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // hash OTP
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    user.resetOtp = hashedOtp;
    user.resetOtpExpiry = Date.now() + 10 * 60 * 1000;

    await user.save();

    // SEND EMAIL HERE

    await transporter.sendMail({
      from: `"Radnus Distribution App" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Password Reset OTP",
      html: `
    <h2>Password Reset</h2>
    <p>Your OTP is:</p>
    <h1>${otp}</h1>
    <p>This OTP expires in 10 minutes.</p>
  `,
    });

    res.json({
      success: true,
      message: "OTP sent to email",
      // otp, //remove for product
    });
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.verifyResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    const user = await Register.findOne({
      email,
      resetOtp: hashedOtp,
      resetOtpExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    res.json({
      success: true,
      message: "OTP verified",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, password } = req.body;

    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    const user = await Register.findOne({
      email,
      resetOtp: hashedOtp,
      resetOtpExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        message: "Invalid or expired OTP",
      });
    }

    user.password = password;

    user.resetOtp = undefined;
    user.resetOtpExpiry = undefined;

    await user.save();

    res.json({
      success: true,
      message: "Password reset successful",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

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

    //  SAFE expiry check
    if (!user.otpExpiry || Number(user.otpExpiry) < Date.now()) {
      return res.status(200).json({
        success: false,
        message: "OTP expired",
      });
    }

    // SAFE OTP check
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
    const { mobile, email, type } = req.body;

    let user;

    // REGISTER FLOW
    if (type === "register") {
      if (!mobile) {
        return res.status(400).json({ message: "Mobile required" });
      }

      user = await Register.findOne({ mobile });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      user.otp = otp;
      user.otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

      await user.save();

      if (user.fcmToken) {
        await admin.messaging().send({
          token: user.fcmToken,
          data: {
            title: "OTP Verification",
            body: `Your OTP is ${otp}`,
            otp: otp,
          },
        });
      }

      return res.json({
        success: true,
        message: "OTP resent successfully",
      });
    }

    // RESET PASSWORD FLOW
    if (type === "reset") {
      if (!email) {
        return res.status(400).json({ message: "Email required" });
      }

      user = await Register.findOne({ email });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

      user.resetOtp = hashedOtp;
      user.resetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);

      await user.save();

      await transporter.sendMail({
        to: email,
        subject: "Password Reset OTP",
        html: `<h2>Your OTP is</h2><h1>${otp}</h1>`,
      });

      return res.json({
        success: true,
        message: "OTP resent successfully",
      });
    }
  } catch (err) {
    console.error("RESEND OTP ERROR:", err);
    res.status(500).json({ message: err.message });
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

    console.log("Entered:", password);
    console.log("Stored:", user.password);

    const isMatch = await bcrypt.compare(password, user.password);
    console.log("Match:", isMatch);

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
