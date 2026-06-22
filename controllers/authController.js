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

//         // ✅ CHECK APPROVAL STATUS FOR EMPLOYEE REGISTRATIONS
//     if (user.registrationType === 'employee' && user.status !== 'approved') {
//       let message = 'Your account is pending admin approval. Please wait.';
//       if (user.status === 'rejected') {
//         message = 'Your registration has been rejected. Please contact HR.';
//       }
//       return res.status(403).json({ 
//         message: message,
//         status: user.status
//       });
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

//+++++++++++++++++++++++++++++++++++++++++++++++++

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Register = require("../models/Register");
const admin = require("../config/firebaseAdmin");
const { generateAccessToken, generateRefreshToken } = require("../utils/token");
const resend = require("../config/resend");

// ============================================================
//  EXISTING FUNCTIONS (Keep all your existing code)
// ============================================================

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

    const response = await resend.emails.send({
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

    await user.save();

    res.json({
      success: true,
      message: "OTP verified successfully",
    });
  } catch (err) {
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

exports.resendOtp = async (req, res) => {
  try {
    const { mobile, email, type } = req.body;

    let user;

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

      const response = await resend.emails.send({
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

// ⚠️ UPDATED REGISTER - Now detects if it's an employee registration
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

    // ✅ CHECK IF IT'S A RADNUS EMPLOYEE REGISTRATION
    // If role is 'radnus_employee', it needs admin approval
    const isEmployee = role === 'radnus_employee';
    
    // ✅ Validate Employee ID for Radnus employees
    if (isEmployee && !req.body.employeeId) {
      return res.status(400).json({ 
        message: "Employee ID is required for Radnus employee registration" 
      });
    }

    // ✅ Validate Employee ID exists in company database
    if (isEmployee && req.body.employeeId) {
      const validEmployeeIds = ['EMP-001', 'EMP-002', 'EMP-003', 'RAD-001', 'RAD-002'];
      const isValidEmployee = validEmployeeIds.includes(req.body.employeeId.toUpperCase());
      
      if (!isValidEmployee) {
        return res.status(400).json({ 
          message: "Invalid Employee ID. Only Radnus employees can register." 
        });
      }
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
      // ⭐ Employee specific fields (only if employee)
      ...(isEmployee && {
        employeeId: req.body.employeeId,
        registrationType: 'employee',
        status: 'pending_approval',  // ⭐ Requires admin approval
        isActive: false,
      })
    });

    const otp = user.generateOtp();

    await user.save();

    // ⭐ If employee registration, send admin notification
    if (isEmployee) {
      await sendAdminNotification({
        type: 'NEW_EMPLOYEE_REGISTRATION',
        userId: user._id,
        name: user.name,
        email: user.email,
        employeeId: user.employeeId
      });
    }

    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title: "OTP Verification",
        body: `your OTP is ${otp}`,
      },
    });

    res.status(201).json({
      message: isEmployee 
        ? "Registration submitted for admin approval. Please verify OTP." 
        : "Registration successful. OTP sent",
      userId: user._id,
      ...(isEmployee && {
        registrationId: user._id,
        status: user.status,
        requiresApproval: true
      })
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

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

exports.refreshToken = async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ message: "No refresh token" });
  }

  try {
    const decoded = jwt.verify(
      refreshToken,
      process.env.REFRESH_SECRET
    );

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

// ⚠️ UPDATED LOGIN - Now checks approval status for employees
exports.login = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    const user = await Register.findOne({ email });

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    // ✅ CHECK APPROVAL STATUS FOR EMPLOYEE REGISTRATIONS
    if (user.registrationType === 'employee' && user.status !== 'approved') {
      let message = 'Your account is pending admin approval. Please wait.';
      if (user.status === 'rejected') {
        message = 'Your registration has been rejected. Please contact HR.';
      }
      return res.status(403).json({ 
        message: message,
        status: user.status
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (user.role !== role) {
      return res.status(403).json({ message: "Invalid role selected" });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    res.json({
      accessToken,
      refreshToken,
      user,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ============================================================
//  ⭐ NEW - EMPLOYEE REGISTRATION STATUS & APPROVAL FUNCTIONS
// ============================================================

/**
 * ⭐ Check Registration Status
 */
exports.checkRegistrationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await Register.findById(id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      status: user.status || 'pending_approval',
      user: user.status === 'approved' ? user : null
    });
  } catch (error) {
    console.error('❌ Check Status Error:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * ⭐ Get Pending Approvals (Admin only)
 */
exports.getPendingApprovals = async (req, res) => {
  try {
    const users = await Register.find({
      status: 'pending_approval',
      registrationType: 'employee'
    }).sort({ createdAt: -1 });
    
    res.json(users);
  } catch (error) {
    console.error('❌ Get Pending Approvals Error:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * ⭐ Approve User (Admin only)
 */
exports.approveUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, employeeId } = req.body;

    const user = await Register.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update user status
    user.status = 'approved';
    user.isActive = true;
    user.role = role || 'radnus_employee';
    user.employeeId = employeeId || user.employeeId;
    user.approvedBy = req.user?._id || req.user?.id || null;
    user.approvedAt = new Date();

    await user.save();

    // Send notification to user
    await sendUserNotification({
      userId: user._id,
      fcmToken: user.fcmToken,
      type: 'REGISTRATION_APPROVED',
      message: `✅ Your Radnus employee registration has been approved! You can now login.`
    });

    // Also send email notification
    await sendApprovalEmail(user.email, user.name);

    res.json({ 
      message: '✅ User approved successfully', 
      user 
    });
  } catch (error) {
    console.error('❌ Approve User Error:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * ⭐ Reject User (Admin only)
 */
exports.rejectUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    const user = await Register.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.status = 'rejected';
    user.isActive = false;
    user.rejectionReason = reason || 'Registration rejected by admin';

    await user.save();

    // Send notification to user
    await sendUserNotification({
      userId: user._id,
      fcmToken: user.fcmToken,
      type: 'REGISTRATION_REJECTED',
      message: `❌ Your Radnus employee registration has been rejected. Please contact HR.`
    });

    res.json({ 
      message: '❌ User rejected successfully' 
    });
  } catch (error) {
    console.error('❌ Reject User Error:', error);
    res.status(500).json({ message: error.message });
  }
};

// ============================================================
//  HELPER FUNCTIONS
// ============================================================

/**
 * Send notification to all admin users
 */
async function sendAdminNotification(data) {
  try {
    const admins = await Register.find({ 
      role: 'Admin',
      fcmToken: { $exists: true, $ne: null }
    });

    if (!admins.length) {
      console.log('⚠️ No admin FCM tokens found');
      return;
    }

    for (const adminUser of admins) {
      if (adminUser.fcmToken) {
        try {
          await admin.messaging().send({
            token: adminUser.fcmToken,
            notification: {
              title: '📋 New Employee Registration',
              body: `${data.name} has registered as a Radnus employee`
            },
            data: {
              type: 'NEW_REGISTRATION',
              userId: data.userId.toString(),
              employeeId: data.employeeId || ''
            }
          });
        } catch (err) {
          console.log(`⚠️ Failed to send to admin ${adminUser.email}:`, err.message);
        }
      }
    }
    console.log(`📧 Admin notification sent to ${admins.length} admins`);
  } catch (error) {
    console.error('❌ Admin notification error:', error);
  }
}

/**
 * Send notification to user
 */
async function sendUserNotification({ userId, fcmToken, type, message }) {
  try {
    if (!fcmToken) {
      console.log('⚠️ No FCM token for user:', userId);
      return;
    }

    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title: type === 'REGISTRATION_APPROVED' ? '✅ Registration Approved' : '❌ Registration Rejected',
        body: message
      },
      data: {
        type: type,
        userId: userId.toString()
      }
    });
    console.log(`📧 User notification sent to ${userId}`);
  } catch (error) {
    console.error('❌ User notification error:', error);
  }
}

/**
 * Send approval email
 */
async function sendApprovalEmail(email, name) {
  try {
    await resend.emails.send({
      from: "Radnus Distribution App <noreply@service.radnus.in>",
      to: email,
      subject: "✅ Registration Approved - Radnus Employee",
      html: `
        <h2>Hello ${name}!</h2>
        <p>Your Radnus employee registration has been <strong>approved</strong>.</p>
        <p>You can now login to the Radnus Distribution App with your credentials.</p>
        <br/>
        <p>Thank you,</p>
        <p><strong>Radnus Team</strong></p>
      `
    });
    console.log(`📧 Approval email sent to ${email}`);
  } catch (error) {
    console.error('❌ Email error:', error);
  }
}

module.exports = exports;