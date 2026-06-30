
// controllers/authController.js
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const Register = require("../models/Register");
const admin = require("../config/firebaseAdmin");
const { generateAccessToken, generateRefreshToken } = require("../utils/token");
const resend = require("../config/resend");
const {
  getApproverRole,
  requiresApproval,
  requiresParentSelection,
  ROLE_LABELS,
} = require("../utils/roleHierarchy");

// Helper function to notify admins about new registration
async function notifyAdminsAboutNewRegistration(user) {
  try {
    const admins = await Register.find({ 
      role: 'Admin',
      isApproved: true,
      isVerified: true,
      fcmToken: { $ne: null }
    });

    for (const adminUser of admins) {
      if (adminUser.fcmToken) {
        await admin.messaging().send({
          token: adminUser.fcmToken,
          notification: {
            title: "🔔 New Registration Pending Approval",
            body: `${user.name} (${user.role}) needs approval.`,
          },
          data: {
            type: 'registration_approval',
            userId: user._id.toString(),
            role: user.role,
            name: user.name,
          }
        });
      }
    }
    console.log(`🔔 Notified ${admins.length} admins about new registration`);
  } catch (error) {
    console.error("Failed to notify admins:", error);
  }
}

// Helper function to notify a specific parent/approver about a new registration
async function notifyParentAboutNewRegistration(parentUser, childUser) {
  try {
    if (!parentUser || !parentUser.fcmToken) return;
    await admin.messaging().send({
      token: parentUser.fcmToken,
      notification: {
        title: "🔔 New Registration Pending Approval",
        body: `${childUser.name} (${ROLE_LABELS[childUser.role] || childUser.role}) needs your approval.`,
      },
      data: {
        type: "registration_approval",
        userId: childUser._id.toString(),
        role: childUser.role,
        name: childUser.name,
      },
    });
  } catch (error) {
    console.error("Failed to notify parent approver:", error);
  }
}

// REGISTER
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
      parentId, // ⭐ specific approver chosen by the user (Distributor / MarketingExecutive / FSE / Retailer)
    } = req.body;

    if (!fcmToken) {
      return res.status(400).json({ message: "FCM token required" });
    }

    // Validation
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

    // Check mobile already exists
    const existingUser = await Register.findOne({ mobile });
    if (existingUser) {
      return res
        .status(409)
        .json({ message: "Mobile number already registered" });
    }

    // ⭐ Hierarchical approval-based registration applies to EVERY role
    // except Admin. Admin accounts never require approval.
    const needsApproval = requiresApproval(role);
    const approverRole = getApproverRole(role);

    let resolvedParentId = null;

    if (needsApproval) {
      if (requiresParentSelection(role)) {
        // Roles like Distributor / MarketingExecutive / FSE / Retailer can
        // have many possible approvers, so the user must pick one.
        if (!parentId) {
          return res.status(400).json({
            message: `Please select the ${ROLE_LABELS[approverRole] || approverRole} who will approve your registration`,
          });
        }

        const parentUser = await Register.findById(parentId);
        if (!parentUser || parentUser.role !== approverRole) {
          return res.status(400).json({
            message: `Selected approver is invalid. Please choose a valid ${ROLE_LABELS[approverRole] || approverRole}`,
          });
        }
        if (parentUser.role !== 'Admin' && parentUser.approvalStatus !== 'approved') {
          return res.status(400).json({
            message: `Selected ${ROLE_LABELS[approverRole] || approverRole} is not yet approved and cannot accept new registrations`,
          });
        }

        resolvedParentId = parentUser._id;
      } else {
        // Radnus Employee / Marketing Manager are approved directly by
        // any Admin — no specific parent selection required.
        resolvedParentId = null;
      }
    }

    // Save user
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
      approvalStatus: needsApproval ? 'pending' : 'approved',
      isApproved: !needsApproval,
      isVerified: false,
      parentId: resolvedParentId,
    });

    const otp = user.generateOtp();
    await user.save();

    // Send OTP via FCM
    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title: "OTP Verification",
        body: `Your OTP is ${otp}`,
      },
    });

    // ⭐ If approval required, notify the appropriate approver(s)
    if (needsApproval) {
      if (resolvedParentId) {
        const parentUser = await Register.findById(resolvedParentId);
        await notifyParentAboutNewRegistration(parentUser, user);
      } else {
        // approverRole === 'Admin' with no specific parent selected
        await notifyAdminsAboutNewRegistration(user);
      }
    }

    res.status(201).json({
      message: needsApproval
        ? `Registration successful. Account pending approval from your ${ROLE_LABELS[approverRole] || approverRole}.`
        : "Registration successful. OTP sent.",
      userId: user._id,
      requiresApproval: needsApproval,
      approvalStatus: user.approvalStatus,
      role: user.role,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// GET ELIGIBLE PARENT/APPROVER LIST (for registration picker)
exports.getEligibleParents = async (req, res) => {
  try {
    const { role } = req.query;
    if (!role) {
      return res.status(400).json({ message: "role query param required" });
    }

    const approverRole = getApproverRole(role);
    if (!approverRole || !requiresParentSelection(role)) {
      return res.json([]); // no specific parent selection needed for this role
    }

    const parents = await Register.find({
      role: approverRole,
      approvalStatus: 'approved',
      isActive: { $ne: false },
    }).select('name email mobile district state taluk role');

    res.json(parents);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// VERIFY OTP
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

// RESEND OTP
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
          notification: {
            title: "OTP Verification",
            body: `Your OTP is ${otp}`,
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

// LOGIN
exports.login = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    const user = await Register.findOne({ email });

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    // ⭐ Approval gate applies to every role except Admin (Admin never
    // requires approval). Other behavior (password check, role check,
    // token issuance) is unchanged.
    if (user.role !== 'Admin') {
      // Inactive accounts: preserve existing behavior — checked here so
      // it always takes effect regardless of approval status.
      if (user.isActive === false) {
        return res.status(403).json({
          message: "Your account is inactive. Please contact your administrator.",
          status: "Inactive",
        });
      }

      if (!user.isApproved) {
        if (user.approvalStatus === 'pending') {
          return res.status(403).json({
            message: "Your account is awaiting approval. Please wait until your registration has been approved.",
            approvalStatus: 'pending',
            status: 'Pending',
          });
        } else if (user.approvalStatus === 'rejected') {
          return res.status(403).json({
            message: "Your registration has been rejected. Please contact your administrator.",
            approvalStatus: 'rejected',
            status: 'Rejected',
          });
        }
      }
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Validate role
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

// ADMIN LOGIN
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

// FORGOT PASSWORD
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

// VERIFY RESET OTP
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

// RESET PASSWORD
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

// REFRESH TOKEN
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

    // ⭐ The env-based super-admin (POST /api/auth/admin) issues refresh
    // tokens with only { email, role: "Admin" } — no `id`, since it has
    // no Register document. Handle that case without a DB lookup.
    if (!decoded.id && decoded.role === 'Admin' && decoded.email) {
      if (decoded.email !== process.env.ADMIN_EMAIL) {
        return res.status(403).json({ message: "Invalid refresh token" });
      }

      const newAccessToken = jwt.sign(
        { email: decoded.email, role: 'Admin' },
        process.env.ACCESS_SECRET,
        { expiresIn: "15m" }
      );

      return res.json({ accessToken: newAccessToken });
    }

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
//__________________________________________________________

// // controllers/authController.js
// const bcrypt = require("bcrypt");
// const jwt = require("jsonwebtoken");
// const crypto = require("crypto");
// const Register = require("../models/Register");
// const admin = require("../config/firebaseAdmin");
// const { generateAccessToken, generateRefreshToken } = require("../utils/token");
// const resend = require("../config/resend");
// const {
//   getApproverRole,
//   requiresApproval,
//   requiresParentSelection,
//   ROLE_LABELS,
// } = require("../utils/roleHierarchy");

// // Helper function to notify admins about new registration
// async function notifyAdminsAboutNewRegistration(user) {
//   try {
//     const admins = await Register.find({ 
//       role: 'Admin',
//       isApproved: true,
//       isVerified: true,
//       fcmToken: { $ne: null }
//     });

//     for (const adminUser of admins) {
//       if (adminUser.fcmToken) {
//         await admin.messaging().send({
//           token: adminUser.fcmToken,
//           notification: {
//             title: "🔔 New Registration Pending Approval",
//             body: `${user.name} (${user.role}) needs approval.`,
//           },
//           data: {
//             type: 'registration_approval',
//             userId: user._id.toString(),
//             role: user.role,
//             name: user.name,
//           }
//         });
//       }
//     }
//     console.log(`🔔 Notified ${admins.length} admins about new registration`);
//   } catch (error) {
//     console.error("Failed to notify admins:", error);
//   }
// }

// // Helper function to notify a specific parent/approver about a new registration
// async function notifyParentAboutNewRegistration(parentUser, childUser) {
//   try {
//     if (!parentUser || !parentUser.fcmToken) return;
//     await admin.messaging().send({
//       token: parentUser.fcmToken,
//       notification: {
//         title: "🔔 New Registration Pending Approval",
//         body: `${childUser.name} (${ROLE_LABELS[childUser.role] || childUser.role}) needs your approval.`,
//       },
//       data: {
//         type: "registration_approval",
//         userId: childUser._id.toString(),
//         role: childUser.role,
//         name: childUser.name,
//       },
//     });
//   } catch (error) {
//     console.error("Failed to notify parent approver:", error);
//   }
// }

// // REGISTER
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
//       parentId, // ⭐ specific approver chosen by the user (Distributor / MarketingExecutive / FSE / Retailer)
//     } = req.body;

//     if (!fcmToken) {
//       return res.status(400).json({ message: "FCM token required" });
//     }

//     // Validation
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

//     // Check mobile already exists
//     const existingUser = await Register.findOne({ mobile });
//     if (existingUser) {
//       return res
//         .status(409)
//         .json({ message: "Mobile number already registered" });
//     }

//     // ⭐ Hierarchical approval-based registration applies to EVERY role
//     // except Admin. Admin accounts never require approval.
//     const needsApproval = requiresApproval(role);
//     const approverRole = getApproverRole(role);

//     let resolvedParentId = null;

//     if (needsApproval) {
//       if (requiresParentSelection(role)) {
//         // Roles like Distributor / MarketingExecutive / FSE / Retailer can
//         // have many possible approvers, so the user must pick one.
//         if (!parentId) {
//           return res.status(400).json({
//             message: `Please select the ${ROLE_LABELS[approverRole] || approverRole} who will approve your registration`,
//           });
//         }

//         const parentUser = await Register.findById(parentId);
//         if (!parentUser || parentUser.role !== approverRole) {
//           return res.status(400).json({
//             message: `Selected approver is invalid. Please choose a valid ${ROLE_LABELS[approverRole] || approverRole}`,
//           });
//         }
//         if (parentUser.role !== 'Admin' && parentUser.approvalStatus !== 'approved') {
//           return res.status(400).json({
//             message: `Selected ${ROLE_LABELS[approverRole] || approverRole} is not yet approved and cannot accept new registrations`,
//           });
//         }

//         resolvedParentId = parentUser._id;
//       } else {
//         // Radnus Employee / Marketing Manager are approved directly by
//         // any Admin — no specific parent selection required.
//         resolvedParentId = null;
//       }
//     }

//     // Save user
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
//       approvalStatus: needsApproval ? 'pending' : 'approved',
//       isApproved: !needsApproval,
//       isVerified: false,
//       parentId: resolvedParentId,
//     });

//     const otp = user.generateOtp();
//     await user.save();

//     // Send OTP via FCM
//     await admin.messaging().send({
//       token: fcmToken,
//       notification: {
//         title: "OTP Verification",
//         body: `Your OTP is ${otp}`,
//       },
//     });

//     // ⭐ If approval required, notify the appropriate approver(s)
//     if (needsApproval) {
//       if (resolvedParentId) {
//         const parentUser = await Register.findById(resolvedParentId);
//         await notifyParentAboutNewRegistration(parentUser, user);
//       } else {
//         // approverRole === 'Admin' with no specific parent selected
//         await notifyAdminsAboutNewRegistration(user);
//       }
//     }

//     res.status(201).json({
//       message: needsApproval
//         ? `Registration successful. Account pending approval from your ${ROLE_LABELS[approverRole] || approverRole}.`
//         : "Registration successful. OTP sent.",
//       userId: user._id,
//       requiresApproval: needsApproval,
//       approvalStatus: user.approvalStatus,
//       role: user.role,
//     });

//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: "Server error" });
//   }
// };

// // GET ELIGIBLE PARENT/APPROVER LIST (for registration picker)
// exports.getEligibleParents = async (req, res) => {
//   try {
//     const { role } = req.query;
//     if (!role) {
//       return res.status(400).json({ message: "role query param required" });
//     }

//     const approverRole = getApproverRole(role);
//     if (!approverRole || !requiresParentSelection(role)) {
//       return res.json([]); // no specific parent selection needed for this role
//     }

//     const parents = await Register.find({
//       role: approverRole,
//       approvalStatus: 'approved',
//       isActive: { $ne: false },
//     }).select('name email mobile district state taluk role');

//     res.json(parents);
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

// // VERIFY OTP
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
//           notification: {
//             title: "OTP Verification",
//             body: `Your OTP is ${otp}`,
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

//       await resend.emails.send({
//         from: "Radnus Distribution App <noreply@service.radnus.in>",
//         to: email,
//         subject: "Password Reset OTP",
//         html: `
//           <h2>Password Reset</h2>
//           <p>Your OTP is:</p>
//           <h1>${otp}</h1>
//           <p>This OTP expires in 10 minutes.</p>
//         `,
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

// // LOGIN
// exports.login = async (req, res) => {
//   try {
//     const { email, password, role } = req.body;

//     const user = await Register.findOne({ email });

//     if (!user) {
//       return res.status(400).json({ message: "User not found" });
//     }

//     // ⭐ Approval gate applies to every role except Admin (Admin never
//     // requires approval). Other behavior (password check, role check,
//     // token issuance) is unchanged.
//     if (user.role !== 'Admin') {
//       // Inactive accounts: preserve existing behavior — checked here so
//       // it always takes effect regardless of approval status.
//       if (user.isActive === false) {
//         return res.status(403).json({
//           message: "Your account is inactive. Please contact your administrator.",
//           status: "Inactive",
//         });
//       }

//       if (!user.isApproved) {
//         if (user.approvalStatus === 'pending') {
//           return res.status(403).json({
//             message: "Your account is awaiting approval. Please wait until your registration has been approved.",
//             approvalStatus: 'pending',
//             status: 'Pending',
//           });
//         } else if (user.approvalStatus === 'rejected') {
//           return res.status(403).json({
//             message: "Your registration has been rejected. Please contact your administrator.",
//             approvalStatus: 'rejected',
//             status: 'Rejected',
//           });
//         }
//       }
//     }

//     // Check password
//     const isMatch = await bcrypt.compare(password, user.password);
//     if (!isMatch) {
//       return res.status(400).json({ message: "Invalid credentials" });
//     }

//     // Validate role
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

// // ADMIN LOGIN
// exports.adminLogin = async (req, res) => {
//   try {
//     const { email, password } = req.body;

//     if (email !== process.env.ADMIN_EMAIL) {
//       return res.status(401).json({ message: "Invalid credentials" });
//     }

//     const isMatch = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
//     if (!isMatch) {
//       return res.status(401).json({ message: "Invalid credentials" });
//     }

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
//       accessToken,
//       refreshToken,
//       user: {
//         email,
//         role: "Admin"
//       }
//     });

//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };

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

//     await resend.emails.send({
//       from: "Radnus Distribution App <noreply@service.radnus.in>",
//       to: email,
//       subject: "Password Reset OTP",
//       html: `
//         <h2>Password Reset</h2>
//         <p>Your OTP is:</p>
//         <h1>${otp}</h1>
//         <p>This OTP expires in 10 minutes.</p>
//       `,
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

// // RESET PASSWORD
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

// // REFRESH TOKEN
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

// //++++++++++++++++++++++++++++++++++++++

// // // controllers/authController.js
// // const bcrypt = require("bcrypt");
// // const jwt = require("jsonwebtoken");
// // const crypto = require("crypto");
// // const Register = require("../models/Register");
// // const admin = require("../config/firebaseAdmin");
// // const { generateAccessToken, generateRefreshToken } = require("../utils/token");
// // const resend = require("../config/resend");

// // // Helper function to notify admins about new registration
// // async function notifyAdminsAboutNewRegistration(user) {
// //   try {
// //     const admins = await Register.find({ 
// //       role: 'Admin',
// //       isApproved: true,
// //       isVerified: true,
// //       fcmToken: { $ne: null }
// //     });

// //     for (const adminUser of admins) {
// //       if (adminUser.fcmToken) {
// //         await admin.messaging().send({
// //           token: adminUser.fcmToken,
// //           notification: {
// //             title: "🔔 New Registration Pending Approval",
// //             body: `${user.name} (${user.role}) needs approval.`,
// //           },
// //           data: {
// //             type: 'registration_approval',
// //             userId: user._id.toString(),
// //             role: user.role,
// //             name: user.name,
// //           }
// //         });
// //       }
// //     }
// //     console.log(`🔔 Notified ${admins.length} admins about new registration`);
// //   } catch (error) {
// //     console.error("Failed to notify admins:", error);
// //   }
// // }

// // // REGISTER
// // exports.register = async (req, res) => {
// //   try {
// //     const {
// //       role,
// //       state,
// //       district,
// //       taluk,
// //       name,
// //       email,
// //       mobile,
// //       password,
// //       confirmPassword,
// //       fcmToken,
// //     } = req.body;

// //     if (!fcmToken) {
// //       return res.status(400).json({ message: "FCM token required" });
// //     }

// //     // Validation
// //     if (
// //       !role ||
// //       !state ||
// //       !district ||
// //       !taluk ||
// //       !name ||
// //       !email ||
// //       !mobile ||
// //       !password
// //     ) {
// //       return res.status(400).json({ message: "All fields are required" });
// //     }

// //     if (password !== confirmPassword) {
// //       return res.status(400).json({ message: "Passwords do not match" });
// //     }

// //     // Check mobile already exists
// //     const existingUser = await Register.findOne({ mobile });
// //     if (existingUser) {
// //       return res
// //         .status(409)
// //         .json({ message: "Mobile number already registered" });
// //     }

// //     // ⭐ Approval-based registration is ONLY for the Radnus Employee Login.
// //     // All other roles keep their existing (auto-approved) behavior.
// //     const rolesRequiringApproval = ['Radnus'];
// //     const requiresApproval = rolesRequiringApproval.includes(role);

// //     // Save user
// //     const user = new Register({
// //       role,
// //       state,
// //       district,
// //       taluk,
// //       name,
// //       email,
// //       mobile,
// //       password,
// //       fcmToken,
// //       approvalStatus: requiresApproval ? 'pending' : 'approved',
// //       isApproved: !requiresApproval,
// //       isVerified: false,
// //     });

// //     const otp = user.generateOtp();
// //     await user.save();

// //     // Send OTP via FCM
// //     await admin.messaging().send({
// //       token: fcmToken,
// //       notification: {
// //         title: "OTP Verification",
// //         body: `Your OTP is ${otp}`,
// //       },
// //     });

// //     // ⭐ If approval required, send notification to admins
// //     if (requiresApproval) {
// //       await notifyAdminsAboutNewRegistration(user);
// //     }

// //     res.status(201).json({
// //       message: requiresApproval 
// //         ? "Registration successful. Account pending admin approval."
// //         : "Registration successful. OTP sent.",
// //       userId: user._id,
// //       requiresApproval,
// //       approvalStatus: user.approvalStatus,
// //       role: user.role,
// //     });

// //   } catch (error) {
// //     console.error(error);
// //     res.status(500).json({ message: "Server error" });
// //   }
// // };

// // // VERIFY OTP
// // exports.verifyOtp = async (req, res) => {
// //   try {
// //     let { mobile, otp } = req.body;

// //     if (!mobile || !otp) {
// //       return res.status(400).json({
// //         success: false,
// //         message: "Mobile and OTP are required",
// //       });
// //     }

// //     mobile = mobile.toString().trim();
// //     otp = otp.toString().trim();

// //     const user = await Register.findOne({ mobile });

// //     if (!user) {
// //       return res.status(404).json({
// //         success: false,
// //         message: "User not found",
// //       });
// //     }

// //     if (!user.otp || user.otp !== otp) {
// //       return res.status(400).json({
// //         success: false,
// //         message: "Invalid OTP",
// //       });
// //     }

// //     if (Date.now() > user.otpExpiry) {
// //       return res.status(400).json({
// //         success: false,
// //         message: "OTP expired",
// //       });
// //     }

// //     user.isVerified = true;
// //     user.otp = null;
// //     user.otpExpiry = null;

// //     await user.save();

// //     res.json({
// //       success: true,
// //       message: "OTP verified successfully",
// //     });
// //   } catch (err) {
// //     res.status(500).json({
// //       success: false,
// //       message: err.message,
// //     });
// //   }
// // };

// // // RESEND OTP
// // exports.resendOtp = async (req, res) => {
// //   try {
// //     const { mobile, email, type } = req.body;

// //     let user;

// //     // REGISTER FLOW
// //     if (type === "register") {
// //       if (!mobile) {
// //         return res.status(400).json({ message: "Mobile required" });
// //       }

// //       user = await Register.findOne({ mobile });

// //       if (!user) {
// //         return res.status(404).json({
// //           success: false,
// //           message: "User not found",
// //         });
// //       }

// //       const otp = Math.floor(100000 + Math.random() * 900000).toString();

// //       user.otp = otp;
// //       user.otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

// //       await user.save();

// //       if (user.fcmToken) {
// //         await admin.messaging().send({
// //           token: user.fcmToken,
// //           notification: {
// //             title: "OTP Verification",
// //             body: `Your OTP is ${otp}`,
// //           },
// //         });
// //       }

// //       return res.json({
// //         success: true,
// //         message: "OTP resent successfully",
// //       });
// //     }

// //     // RESET PASSWORD FLOW
// //     if (type === "reset") {
// //       if (!email) {
// //         return res.status(400).json({ message: "Email required" });
// //       }

// //       user = await Register.findOne({ email });

// //       if (!user) {
// //         return res.status(404).json({
// //           success: false,
// //           message: "User not found",
// //         });
// //       }

// //       const otp = Math.floor(100000 + Math.random() * 900000).toString();

// //       const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

// //       user.resetOtp = hashedOtp;
// //       user.resetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);

// //       await user.save();

// //       await resend.emails.send({
// //         from: "Radnus Distribution App <noreply@service.radnus.in>",
// //         to: email,
// //         subject: "Password Reset OTP",
// //         html: `
// //           <h2>Password Reset</h2>
// //           <p>Your OTP is:</p>
// //           <h1>${otp}</h1>
// //           <p>This OTP expires in 10 minutes.</p>
// //         `,
// //       });

// //       return res.json({
// //         success: true,
// //         message: "OTP resent successfully",
// //       });
// //     }
// //   } catch (err) {
// //     console.error("RESEND OTP ERROR:", err);
// //     res.status(500).json({ message: err.message });
// //   }
// // };

// // // LOGIN
// // exports.login = async (req, res) => {
// //   try {
// //     const { email, password, role } = req.body;

// //     const user = await Register.findOne({ email });

// //     if (!user) {
// //       return res.status(400).json({ message: "User not found" });
// //     }

// //     // ⭐ Approval gate applies ONLY to the Radnus Employee Login.
// //     // Other roles/modules are unaffected and login proceeds as before.
// //     if (user.role === 'Radnus' && !user.isApproved) {
// //       if (user.approvalStatus === 'pending') {
// //         return res.status(403).json({
// //           message: "Your account is awaiting admin approval.",
// //           approvalStatus: 'pending'
// //         });
// //       } else if (user.approvalStatus === 'rejected') {
// //         return res.status(403).json({
// //           message: "Your registration has been rejected. Please contact the administrator.",
// //           approvalStatus: 'rejected'
// //         });
// //       }
// //     }

// //     // Check password
// //     const isMatch = await bcrypt.compare(password, user.password);
// //     if (!isMatch) {
// //       return res.status(400).json({ message: "Invalid credentials" });
// //     }

// //     // Validate role
// //     if (user.role !== role) {
// //       return res.status(403).json({ message: "Invalid role selected" });
// //     }

// //     const accessToken = generateAccessToken(user);
// //     const refreshToken = generateRefreshToken(user);

// //     res.json({
// //       accessToken,
// //       refreshToken,
// //       user,
// //     });

// //   } catch (err) {
// //     res.status(500).json({ message: err.message });
// //   }
// // };

// // // ADMIN LOGIN
// // exports.adminLogin = async (req, res) => {
// //   try {
// //     const { email, password } = req.body;

// //     if (email !== process.env.ADMIN_EMAIL) {
// //       return res.status(401).json({ message: "Invalid credentials" });
// //     }

// //     const isMatch = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
// //     if (!isMatch) {
// //       return res.status(401).json({ message: "Invalid credentials" });
// //     }

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

// //     res.json({
// //       accessToken,
// //       refreshToken,
// //       user: {
// //         email,
// //         role: "Admin"
// //       }
// //     });

// //   } catch (err) {
// //     res.status(500).json({ message: err.message });
// //   }
// // };

// // // FORGOT PASSWORD
// // exports.forgotPassword = async (req, res) => {
// //   try {
// //     const { email } = req.body;

// //     if (!email) {
// //       return res.status(400).json({
// //         message: "Email is required",
// //       });
// //     }

// //     const user = await Register.findOne({ email });

// //     if (!user) {
// //       return res.json({
// //         success: true,
// //         message: "If email exists, OTP sent",
// //       });
// //     }

// //     const otp = Math.floor(100000 + Math.random() * 900000).toString();

// //     const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

// //     user.resetOtp = hashedOtp;
// //     user.resetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);

// //     await user.save();

// //     await resend.emails.send({
// //       from: "Radnus Distribution App <noreply@service.radnus.in>",
// //       to: email,
// //       subject: "Password Reset OTP",
// //       html: `
// //         <h2>Password Reset</h2>
// //         <p>Your OTP is:</p>
// //         <h1>${otp}</h1>
// //         <p>This OTP expires in 10 minutes.</p>
// //       `,
// //     });

// //     return res.json({
// //       success: true,
// //       message: "OTP sent to email",
// //     });
// //   } catch (err) {
// //     console.error("FORGOT PASSWORD ERROR:", err);
// //     res.status(500).json({
// //       success: false,
// //       message: err.message,
// //     });
// //   }
// // };

// // // VERIFY RESET OTP
// // exports.verifyResetOtp = async (req, res) => {
// //   try {
// //     const { email, otp } = req.body;

// //     const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

// //     const user = await Register.findOne({
// //       email,
// //       resetOtp: hashedOtp,
// //       resetOtpExpiry: { $gt: Date.now() },
// //     });

// //     if (!user) {
// //       return res.status(400).json({
// //         success: false,
// //         message: "Invalid or expired OTP",
// //       });
// //     }

// //     res.json({
// //       success: true,
// //       message: "OTP verified",
// //     });
// //   } catch (err) {
// //     res.status(500).json({ message: err.message });
// //   }
// // };

// // // RESET PASSWORD
// // exports.resetPassword = async (req, res) => {
// //   try {
// //     const { email, otp, password } = req.body;

// //     const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

// //     const user = await Register.findOne({
// //       email,
// //       resetOtp: hashedOtp,
// //       resetOtpExpiry: { $gt: Date.now() },
// //     });

// //     if (!user) {
// //       return res.status(400).json({
// //         message: "Invalid or expired OTP",
// //       });
// //     }

// //     user.password = password;
// //     user.resetOtp = undefined;
// //     user.resetOtpExpiry = undefined;

// //     await user.save();

// //     res.json({
// //       success: true,
// //       message: "Password reset successful",
// //     });
// //   } catch (err) {
// //     res.status(500).json({ message: err.message });
// //   }
// // };

// // // REFRESH TOKEN
// // exports.refreshToken = async (req, res) => {
// //   const { refreshToken } = req.body;

// //   if (!refreshToken) {
// //     return res.status(401).json({ message: "No refresh token" });
// //   }

// //   try {
// //     const decoded = jwt.verify(
// //       refreshToken,
// //       process.env.REFRESH_SECRET
// //     );

// //     const user = await Register.findById(decoded.id);

// //     if (!user) {
// //       return res.status(404).json({ message: "User not found" });
// //     }

// //     const newAccessToken = jwt.sign(
// //       { id: user._id, role: user.role },
// //       process.env.ACCESS_SECRET,
// //       { expiresIn: "15m" }
// //     );

// //     res.json({ accessToken: newAccessToken });

// //   } catch (err) {
// //     console.log("Refresh error:", err.message);
// //     res.status(403).json({ message: "Invalid refresh token" });
// //   }
// // };
