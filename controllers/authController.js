// controllers/authController.js
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Register = require("../models/Register");
const admin = require("../config/firebaseAdmin");
const { generateAccessToken, generateRefreshToken } = require("../utils/token");
const resend = require("../config/resend");

// ─── FORGOT PASSWORD ──────────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    const user = await Register.findOne({ email });

    if (!user) {
      return res.json({
        success: true,
        message: "If email exists, OTP sent",
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    user.resetOtp = hashedOtp;
    user.resetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await resend.emails.send({
      from: "Radnus Distribution App <noreply@service.radnus.in>",
      to: email,
      subject: "Password Reset OTP",
      html: `
        <h2>Password Reset</h2>
        <p>Your OTP is:</p>
        <h1>${otp}</h1>
        <p>This OTP expires in 10 minutes.</p>
      `,
    });

    return res.json({
      success: true,
      message: "OTP sent to email",
    });
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ─── VERIFY RESET OTP ────────────────────────────────────────────────
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

// ─── RESET PASSWORD ──────────────────────────────────────────────────
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

    // Password will be hashed by pre-save hook
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

// ─── VERIFY OTP ──────────────────────────────────────────────────────
exports.verifyOtp = async (req, res) => {
  try {
    let { mobile, otp } = req.body;

    if (!mobile || !otp) {
      return res.status(400).json({
        success: false,
        message: "Mobile and OTP are required",
      });
    }

    mobile = mobile.toString().trim();
    otp = otp.toString().trim();

    const user = await Register.findOne({ mobile });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // ✅ Check approval for Radnus
    if (user.role === 'Radnus' && !user.isApproved) {
      return res.status(403).json({
        success: false,
        message: "Account pending admin approval. Please wait.",
        requiresApproval: true,
        status: user.status
      });
    }

    if (!user.otp || user.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    if (Date.now() > user.otpExpiry) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    user.isVerified = true;
    user.otp = null;
    user.otpExpiry = null;
    user.status = 'approved';

    await user.save();

    res.json({
      success: true,
      message: "OTP verified successfully",
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        isVerified: user.isVerified,
        isApproved: user.isApproved
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ─── RESEND OTP ──────────────────────────────────────────────────────
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

      await resend.emails.send({
        from: "Radnus Distribution App <noreply@service.radnus.in>",
        to: email,
        subject: "Password Reset OTP",
        html: `
          <h2>Password Reset</h2>
          <p>Your OTP is:</p>
          <h1>${otp}</h1>
          <p>This OTP expires in 10 minutes.</p>
        `,
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

// ─── REGISTER ────────────────────────────────────────────────────────
exports.register = async (req, res) => {
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

    const existingUser = await Register.findOne({ mobile });
    if (existingUser) {
      return res
        .status(409)
        .json({ message: "Mobile number already registered" });
    }

    const existingEmail = await Register.findOne({ email });
    if (existingEmail) {
      return res
        .status(409)
        .json({ message: "Email already registered" });
    }

    // ─── APPROVAL LOGIC ──────────────────────────────────────────────
    let isApproved = false;
    let status = 'pending';

    if (role === 'Radnus') {
      // Radnus requires admin approval
      isApproved = false;
      status = 'pending';
    } else {
      // Other roles are auto-approved
      isApproved = true;
      status = 'approved';
    }

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
      isApproved,
      status,
      isVerified: false,
    });

    const otp = user.generateOtp();
    await user.save();

    // ─── SEND OTP ─────────────────────────────────────────────────────
    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title: "OTP Verification",
        body: `Your OTP is ${otp}`,
      },
    });

    // ─── NOTIFY ADMIN FOR RADNUS ────────────────────────────────────
    if (role === 'Radnus') {
      const admins = await Register.find({ role: 'Admin' });
      
      for (const adminUser of admins) {
        if (adminUser.fcmToken) {
          await admin.messaging().send({
            token: adminUser.fcmToken,
            notification: {
              title: "New Radnus Registration",
              body: `${name} (${email}) has registered. Please approve.`,
            },
            data: {
              type: 'new_radnus_registration',
              userId: user._id.toString(),
              name: user.name,
              email: user.email,
              mobile: user.mobile,
            }
          }).catch(err => console.error('Admin notification failed:', err));
        }
      }
    }

    res.status(201).json({
      message: role === 'Radnus' 
        ? "Registration successful. Awaiting admin approval."
        : "Registration successful. OTP sent",
      userId: user._id,
      requiresApproval: role === 'Radnus',
      isApproved: user.isApproved,
      status: user.status,
    });

  } catch (error) {
    console.error("REGISTER ERROR:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ─── LOGIN ───────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    const user = await Register.findOne({ email });

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (user.role !== role) {
      return res.status(403).json({ message: "Invalid role selected" });
    }

    if (user.role === 'Radnus' && !user.isApproved) {
      return res.status(403).json({
        message: "Account pending admin approval",
        requiresApproval: true,
        status: user.status
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        message: "Please verify your OTP first",
        requiresOTP: true
      });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        state: user.state,
        district: user.district,
        taluk: user.taluk,
        isVerified: user.isVerified,
        isApproved: user.isApproved
      }
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─── ADMIN LOGIN ────────────────────────────────────────────────────
exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (email !== process.env.ADMIN_EMAIL) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const accessToken = jwt.sign(
      { email, role: "Admin" },
      process.env.ACCESS_SECRET,
      { expiresIn: "15m" }
    );
    
    const refreshToken = jwt.sign(
      { email, role: "Admin" },
      process.env.REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      accessToken,
      refreshToken,
      user: {
        email,
        role: "Admin"
      }
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─── REFRESH TOKEN ──────────────────────────────────────────────────
exports.refreshToken = async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ message: "No refresh token" });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);

    const user = await Register.findById(decoded.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const newAccessToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.ACCESS_SECRET,
      { expiresIn: "15m" }
    );

    res.json({ accessToken: newAccessToken });

  } catch (err) {
    console.log("Refresh error:", err.message);
    res.status(403).json({ message: "Invalid refresh token" });
  }
};

// ─── ADMIN APPROVAL FUNCTIONS ──────────────────────────────────────

exports.approveRadnus = async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;

    const adminUser = await Register.findById(adminId);
    if (!adminUser || adminUser.role !== 'Admin') {
      return res.status(403).json({ 
        message: "Only Admin can approve Radnus users" 
      });
    }

    const user = await Register.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role !== 'Radnus') {
      return res.status(400).json({ 
        message: "Only Radnus users require admin approval" 
      });
    }

    if (user.isApproved) {
      return res.status(400).json({ 
        message: "User is already approved" 
      });
    }

    user.isApproved = true;
    user.status = 'approved';
    user.approvedBy = adminId;
    user.approvedAt = new Date();
    user.updatedAt = new Date();

    await user.save();

    if (user.fcmToken) {
      await admin.messaging().send({
        token: user.fcmToken,
        notification: {
          title: "Account Approved",
          body: "Your Radnus account has been approved by Admin. Please verify OTP to complete registration.",
        }
      }).catch(err => console.error('Notification failed:', err));
    }

    res.json({
      success: true,
      message: "Radnus user approved successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        status: user.status,
        isApproved: user.isApproved
      }
    });

  } catch (err) {
    console.error("APPROVAL ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.rejectRadnus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { rejectionReason } = req.body;
    const adminId = req.user.id;

    const adminUser = await Register.findById(adminId);
    if (!adminUser || adminUser.role !== 'Admin') {
      return res.status(403).json({ 
        message: "Only Admin can reject Radnus users" 
      });
    }

    const user = await Register.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role !== 'Radnus') {
      return res.status(400).json({ 
        message: "Only Radnus users can be rejected" 
      });
    }

    if (user.isApproved) {
      return res.status(400).json({ 
        message: "User is already approved, cannot reject" 
      });
    }

    user.status = 'rejected';
    user.rejectionReason = rejectionReason || 'No reason provided';
    user.updatedAt = new Date();

    await user.save();

    if (user.fcmToken) {
      await admin.messaging().send({
        token: user.fcmToken,
        notification: {
          title: "Account Rejected",
          body: `Your Radnus account was rejected. Reason: ${user.rejectionReason}`,
        }
      }).catch(err => console.error('Notification failed:', err));
    }

    res.json({
      success: true,
      message: "Radnus user rejected",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        status: user.status,
        rejectionReason: user.rejectionReason
      }
    });

  } catch (err) {
    console.error("REJECTION ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.getPendingRadnusUsers = async (req, res) => {
  try {
    const adminId = req.user.id;

    const adminUser = await Register.findById(adminId);
    if (!adminUser || adminUser.role !== 'Admin') {
      return res.status(403).json({ 
        message: "Only Admin can view pending Radnus users" 
      });
    }

    const pendingUsers = await Register.find({
      role: 'Radnus',
      status: 'pending',
      isApproved: false
    }).select('-password -otp -resetOtp -resetOtpExpiry');

    res.json({
      success: true,
      count: pendingUsers.length,
      users: pendingUsers
    });

  } catch (err) {
    console.error("FETCH PENDING ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.getAllRadnusUsers = async (req, res) => {
  try {
    const adminId = req.user.id;

    const adminUser = await Register.findById(adminId);
    if (!adminUser || adminUser.role !== 'Admin') {
      return res.status(403).json({ 
        message: "Only Admin can view Radnus users" 
      });
    }

    const radnusUsers = await Register.find({
      role: 'Radnus'
    }).select('-password -otp -resetOtp -resetOtpExpiry')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: radnusUsers.length,
      users: radnusUsers
    });

  } catch (err) {
    console.error("FETCH ALL RADNUS ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.getPendingCount = async (req, res) => {
  try {
    const adminId = req.user.id;

    const adminUser = await Register.findById(adminId);
    if (!adminUser || adminUser.role !== 'Admin') {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const pendingCount = await Register.countDocuments({
      role: 'Radnus',
      status: 'pending',
      isApproved: false
    });

    res.json({
      success: true,
      pendingCount
    });

  } catch (err) {
    console.error("PENDING COUNT ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

//-------- below old code -----------------

// const bcrypt = require("bcrypt");
// const jwt = require("jsonwebtoken");
// const crypto = require("crypto");
// const Register = require("../models/Register");
// const admin = require("../config/firebaseAdmin");
// // const transporter = require("../config/mailer");
// const { generateAccessToken, generateRefreshToken } = require("../utils/token");
// const resend = require("../config/resend");

// // FORGOT PASSWORD
// exports.forgotPassword = async (req, res) => {
//   try {
//     const { email } = req.body;

//     if (!email) {
//       return res.status(400).json({
//         message: "Email is required",
//       });
//     }

//     const user = await Register.findOne({ email });

//     if (!user) {
//       return res.json({
//         success: true,
//         message: "If email exists, OTP sent",
//       });
//     }

//     const otp = Math.floor(100000 + Math.random() * 900000).toString();

//     const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

//     user.resetOtp = hashedOtp;
//     user.resetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);

//     await user.save();

//     const response = await resend.emails.send({
//       from: "Radnus Distribution App <noreply@service.radnus.in>",
//       to: email,
//       subject: "Password Reset OTP",
//       html: `
//     <h2>Password Reset</h2>
//     <p>Your OTP is:</p>
//     <h1>${otp}</h1>
//     <p>This OTP expires in 10 minutes.</p>
//   `,
//     });

//     return res.json({
//       success: true,
//       message: "OTP sent to email",
//     });
//   } catch (err) {
//     console.error("FORGOT PASSWORD ERROR:", err);
//     res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// exports.verifyOtp = async (req, res) => {
//   try {
//     let { mobile, otp } = req.body;

//     if (!mobile || !otp) {
//       return res.status(400).json({
//         success: false,
//         message: "Mobile and OTP are required",
//       });
//     }

//     mobile = mobile.toString().trim();
//     otp = otp.toString().trim();

//     const user = await Register.findOne({ mobile });

//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: "User not found",
//       });
//     }

//     if (!user.otp || user.otp !== otp) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid OTP",
//       });
//     }

//     if (Date.now() > user.otpExpiry) {
//       return res.status(400).json({
//         success: false,
//         message: "OTP expired",
//       });
//     }

//     user.isVerified = true;
//     user.otp = null;
//     user.otpExpiry = null;

//     await user.save();

//     res.json({
//       success: true,
//       message: "OTP verified successfully",
//     });
//   } catch (err) {
//     res.status(500).json({
//       success: false,
//       message: err.message,
//     });
//   }
// };

// // VERIFY RESET OTP
// exports.verifyResetOtp = async (req, res) => {
//   try {
//     const { email, otp } = req.body;

//     const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

//     const user = await Register.findOne({
//       email,
//       resetOtp: hashedOtp,
//       resetOtpExpiry: { $gt: Date.now() },
//     });

//     if (!user) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid or expired OTP",
//       });
//     }

//     res.json({
//       success: true,
//       message: "OTP verified",
//     });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };



// exports.resetPassword = async (req, res) => {
//   try {
//     const { email, otp, password } = req.body;

//     const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

//     const user = await Register.findOne({
//       email,
//       resetOtp: hashedOtp,
//       resetOtpExpiry: { $gt: Date.now() },
//     });

//     if (!user) {
//       return res.status(400).json({
//         message: "Invalid or expired OTP",
//       });
//     }

//     // Don't hash manually if model already hashes
//     user.password = password;

//     user.resetOtp = undefined;
//     user.resetOtpExpiry = undefined;

//     await user.save();

//     res.json({
//       success: true,
//       message: "Password reset successful",
//     });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

// // RESEND OTP
// exports.resendOtp = async (req, res) => {
//   try {
//     const { mobile, email, type } = req.body;

//     let user;

//     // REGISTER FLOW
//     if (type === "register") {
//       if (!mobile) {
//         return res.status(400).json({ message: "Mobile required" });
//       }

//       user = await Register.findOne({ mobile });

//       if (!user) {
//         return res.status(404).json({
//           success: false,
//           message: "User not found",
//         });
//       }

//       const otp = Math.floor(100000 + Math.random() * 900000).toString();

//       user.otp = otp;
//       user.otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

//       await user.save();

//       if (user.fcmToken) {
//         await admin.messaging().send({
//           token: user.fcmToken,
//           data: {
//             title: "OTP Verification",
//             body: `Your OTP is ${otp}`,
//             otp: otp,
//           },
//         });
//       }

//       return res.json({
//         success: true,
//         message: "OTP resent successfully",
//       });
//     }

//     // RESET PASSWORD FLOW
//     if (type === "reset") {
//       if (!email) {
//         return res.status(400).json({ message: "Email required" });
//       }

//       user = await Register.findOne({ email });

//       if (!user) {
//         return res.status(404).json({
//           success: false,
//           message: "User not found",
//         });
//       }

//       const otp = Math.floor(100000 + Math.random() * 900000).toString();

//       const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

//       user.resetOtp = hashedOtp;
//       user.resetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);

//       await user.save();

//       // await resend.emails.send({
//       //   from: `"Radnus Distribution App"<${process.env.EMAIL_USER}>`,
//       //   to: email,
//       //   subject: "Password Reset OTP",
//       //   html: `<h2>Your OTP is</h2><h1>${otp}</h1>`,
//       // });

//       const response = await resend.emails.send({
//         from: "Radnus Distribution App <noreply@service.radnus.in>",
//         to: email,
//         subject: "Password Reset OTP",
//         html: `
//     <h2>Password Reset</h2>
//     <p>Your OTP is:</p>
//     <h1>${otp}</h1>
//     <p>This OTP expires in 10 minutes.</p>
//   `,
//       });

//       return res.json({
//         success: true,
//         message: "OTP resent successfully",
//       });
//     }
//   } catch (err) {
//     console.error("RESEND OTP ERROR:", err);
//     res.status(500).json({ message: err.message });
//   }
// };

// //register
// exports.register = async (req, res) => {
//   try {
//     const {
//       role,
//       state,
//       district,
//       taluk,
//       name,
//       email,
//       mobile,
//       password,
//       confirmPassword,
//       fcmToken,
//     } = req.body;

//     if (!fcmToken) {
//       return res.status(400).json({ message: "FCM token required" });
//     }

//     // 🔍 Validation
//     if (
//       !role ||
//       !state ||
//       !district ||
//       !taluk ||
//       !name ||
//       !email ||
//       !mobile ||
//       !password
//     ) {
//       return res.status(400).json({ message: "All fields are required" });
//     }

//     if (password !== confirmPassword) {
//       return res.status(400).json({ message: "Passwords do not match" });
//     }

//     // 📱 Check mobile already exists
//     const existingUser = await Register.findOne({ mobile });
//     if (existingUser) {
//       return res
//         .status(409)
//         .json({ message: "Mobile number already registered" });
//     }

//     // 💾 Save user
//     const user = new Register({
//       role,
//       state,
//       district,
//       taluk,
//       name,
//       email,
//       mobile,
//       password,
//       fcmToken,
//     });

//     const otp = user.generateOtp();

//     await user.save();

//     // send push notification
//     await admin.messaging().send({
//       token: fcmToken,
//       notification: {
//         title: "OTP Verification",
//         body: `your OTP is ${otp}`,
//       },
//     });

//     res.status(201).json({
//       message: "Registration successful. OTP sent",
//       userId: user._id,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: "Server error" });
//   }
// };


// // exports.adminLogin = async (req, res) => {
// //   try {
// //     const { email, password } = req.body;

// //     // DEBUG LOGS
// //     console.log("📧 Received email:", email);
// //     console.log("🔑 Received password:", password);
// //     console.log("✅ ENV email:", process.env.ADMIN_EMAIL);
// //     console.log("✅ ENV hash:", process.env.ADMIN_PASSWORD_HASH);

// //     // Guard: check .env values exist
// //     if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_HASH) {
// //       console.log("❌ ENV credentials missing");
// //       return res.status(500).json({ message: "Admin credentials not configured" });
// //     }

// //     if (email !== process.env.ADMIN_EMAIL) {
// //       console.log("❌ Email mismatch");
// //       return res.status(400).json({ message: "Invalid credentials" });
// //     }

// //     const isMatch = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
// //     console.log("🔐 Password match:", isMatch);

// //     if (!isMatch) {
// //       console.log("❌ Password wrong");
// //       return res.status(400).json({ message: "Invalid credentials" });
// //     }

// //     const token = jwt.sign(
// //       { role: "Admin", email },
// //       process.env.JWT_SECRET,
// //       { expiresIn: "1d" }
// //     );

// //     console.log("✅ Admin login success");

// //     res.json({
// //       token,
// //       admin: { email, role: "Admin" },
// //     });

// //   } catch (err) {
// //     console.log("💥 Error:", err.message);
// //     res.status(500).json({ message: err.message });
// //   }
// // };

// //----------------------- old ---------------------------
// // exports.adminLogin = async (req, res) => {
// //   try {
// //     const { email, password } = req.body;

// //     // Validate credentials against .env
// //     if (email !== process.env.ADMIN_EMAIL) {
// //       return res.status(401).json({ message: "Invalid credentials" });
// //     }

// //     const isMatch = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
// //     if (!isMatch) {
// //       return res.status(401).json({ message: "Invalid credentials" });
// //     }

// //     // Generate tokens
// //     const accessToken = jwt.sign(
// //       { email, role: "Admin" },
// //       process.env.ACCESS_SECRET,
// //       { expiresIn: "15m" }
// //     );
    
// //     const refreshToken = jwt.sign(
// //       { email, role: "Admin" },
// //       process.env.REFRESH_SECRET,
// //       { expiresIn: "7d" }
// //     );

// //     // ✅ RETURN SAME STRUCTURE AS USER LOGIN
// //     res.json({
// //       accessToken,     // ← Changed from 'token' to 'accessToken'
// //       refreshToken,    // ← Added refresh token
// //       user: {          // ← Changed from 'admin' to 'user' for consistency
// //         email,
// //         role: "Admin"
// //       }
// //     });

// //   } catch (err) {
// //     res.status(500).json({ message: err.message });
// //   }
// // };

// exports.adminLogin = async (req, res) => {
//   try {
//     const { email, password } = req.body;

//     // Validate against .env
//     if (email !== process.env.ADMIN_EMAIL) {
//       return res.status(401).json({ message: "Invalid credentials" });
//     }

//     const isMatch = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
//     if (!isMatch) {
//       return res.status(401).json({ message: "Invalid credentials" });
//     }

//     // ✅ GENERATE ACCESS & REFRESH TOKENS (same as user)
//     const accessToken = jwt.sign(
//       { email, role: "Admin" },
//       process.env.ACCESS_SECRET,
//       { expiresIn: "15m" }
//     );
    
//     const refreshToken = jwt.sign(
//       { email, role: "Admin" },
//       process.env.REFRESH_SECRET,
//       { expiresIn: "7d" }
//     );

//     res.json({
//       accessToken,    // ✅ Use same field names as user login
//       refreshToken,   // ✅ Use same field names as user login
//       user: {         // ✅ Use 'user' field (not 'admin')
//         email,
//         role: "Admin"
//       }
//     });

//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

// exports.refreshToken = async (req, res) => {
//   const { refreshToken } = req.body;

//   if (!refreshToken) {
//     return res.status(401).json({ message: "No refresh token" });
//   }

//   try {
//     const decoded = jwt.verify(
//       refreshToken,
//       process.env.REFRESH_SECRET
//     );

//     const user = await Register.findById(decoded.id);

//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     const newAccessToken = jwt.sign(
//       { id: user._id, role: user.role },
//       process.env.ACCESS_SECRET,
//       { expiresIn: "15m" }
//     );

//     res.json({ accessToken: newAccessToken });

//   } catch (err) {
//     console.log("Refresh error:", err.message);
//     res.status(403).json({ message: "Invalid refresh token" });
//   }
// };



// exports.login = async (req, res) => {
//   try {
//     const { email, password, role } = req.body;   // ✅ ADD THIS

//     const user = await Register.findOne({ email });

//     if (!user) {
//       return res.status(400).json({ message: "User not found" });
//     }

//     const isMatch = await bcrypt.compare(password, user.password);

//     if (!isMatch) {
//       return res.status(400).json({ message: "Invalid credentials" });
//     }

//     // ✅ ADD ROLE CHECK BACK
//     if (user.role !== role) {
//       return res.status(403).json({ message: "Invalid role selected" });
//     }

//     const accessToken = generateAccessToken(user);
//     const refreshToken = generateRefreshToken(user);

//     res.json({
//       accessToken,
//       refreshToken,
//       user,
//     });

//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };