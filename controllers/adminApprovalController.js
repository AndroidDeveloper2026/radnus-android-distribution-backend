const Register = require("../models/Register");
const admin = require("../config/firebaseAdmin");

// 📋 GET ALL PENDING REGISTRATIONS
exports.getPendingRegistrations = async (req, res) => {
  try {
    // Only Admin can access this
    if (req.user.role !== "Admin") {
      return res.status(403).json({ message: "Access denied. Admin only." });
    }

    const pendingUsers = await Register.find({
      registrationStatus: "pending",
      role: "Radnus", // Only Radnus employee registrations
    }).select("-password -otp -resetOtp");

    res.json({
      success: true,
      count: pendingUsers.length,
      users: pendingUsers,
    });
  } catch (err) {
    console.error("Get pending registrations error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ✅ APPROVE REGISTRATION
exports.approveRegistration = async (req, res) => {
  try {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ message: "Access denied. Admin only." });
    }

    const { userId } = req.params;
    const { employeeId, department, designation } = req.body;

    const user = await Register.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.registrationStatus !== "pending") {
      return res.status(400).json({
        message: `Registration already ${user.registrationStatus}`,
      });
    }

    if (user.role !== "Radnus") {
      return res.status(400).json({
        message: "Only Radnus employees can be approved through this system",
      });
    }

    // ✅ Update user
    user.isApproved = true;
    user.registrationStatus = "approved";
    user.approvedBy = req.user.id;
    user.approvedAt = new Date();

    if (employeeId) user.employeeId = employeeId;
    if (department) user.department = department;
    if (designation) user.designation = designation;

    await user.save();

    // 📱 Send FCM notification to user
    if (user.fcmToken) {
      try {
        await admin.messaging().send({
          token: user.fcmToken,
          notification: {
            title: "Registration Approved! 🎉",
            body: "Your account has been approved. You can now login.",
          },
          data: {
            type: "registration_approved",
            userId: user._id.toString(),
          },
        });
      } catch (fcmError) {
        console.error("FCM notification error:", fcmError);
        // Don't fail the approval if notification fails
      }
    }

    res.json({
      success: true,
      message: "Registration approved successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        registrationStatus: user.registrationStatus,
      },
    });
  } catch (err) {
    console.error("Approval error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ❌ REJECT REGISTRATION
exports.rejectRegistration = async (req, res) => {
  try {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ message: "Access denied. Admin only." });
    }

    const { userId } = req.params;
    const { rejectionReason } = req.body;

    const user = await Register.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.registrationStatus !== "pending") {
      return res.status(400).json({
        message: `Registration already ${user.registrationStatus}`,
      });
    }

    user.registrationStatus = "rejected";
    user.rejectionReason = rejectionReason || "Registration rejected by admin";
    user.isApproved = false;

    await user.save();

    // 📱 Send FCM notification
    if (user.fcmToken) {
      try {
        await admin.messaging().send({
          token: user.fcmToken,
          notification: {
            title: "Registration Update",
            body: `Your registration was rejected. Reason: ${user.rejectionReason}`,
          },
          data: {
            type: "registration_rejected",
            userId: user._id.toString(),
          },
        });
      } catch (fcmError) {
        console.error("FCM notification error:", fcmError);
        // Don't fail the rejection if notification fails
      }
    }

    res.json({
      success: true,
      message: "Registration rejected",
      rejectionReason: user.rejectionReason,
    });
  } catch (err) {
    console.error("Rejection error:", err);
    res.status(500).json({ message: err.message });
  }
};

// 📊 GET REGISTRATION STATISTICS
exports.getRegistrationStats = async (req, res) => {
  try {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ message: "Access denied. Admin only." });
    }

    const stats = await Register.aggregate([
      { $match: { role: "Radnus" } },
      {
        $group: {
          _id: "$registrationStatus",
          count: { $sum: 1 },
        },
      },
    ]);

    const total = await Register.countDocuments({ role: "Radnus" });

    const result = {
      pending: 0,
      approved: 0,
      rejected: 0,
    };

    stats.forEach((item) => {
      if (item._id === "pending") result.pending = item.count;
      if (item._id === "approved") result.approved = item.count;
      if (item._id === "rejected") result.rejected = item.count;
    });

    res.json({
      success: true,
      total,
      stats: result,
    });
  } catch (err) {
    console.error("Stats error:", err);
    res.status(500).json({ message: err.message });
  }
};

// 🔍 GET SINGLE PENDING REGISTRATION DETAILS
exports.getRegistrationDetails = async (req, res) => {
  try {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ message: "Access denied. Admin only." });
    }

    const { userId } = req.params;

    const user = await Register.findById(userId).select("-password -otp -resetOtp");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      user,
    });
  } catch (err) {
    console.error("Get registration details error:", err);
    res.status(500).json({ message: err.message });
  }
};

// 📝 BULK APPROVE REGISTRATIONS
exports.bulkApproveRegistrations = async (req, res) => {
  try {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ message: "Access denied. Admin only." });
    }

    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ message: "User IDs array is required" });
    }

    const result = await Register.updateMany(
      {
        _id: { $in: userIds },
        registrationStatus: "pending",
        role: "Radnus",
      },
      {
        $set: {
          isApproved: true,
          registrationStatus: "approved",
          approvedBy: req.user.id,
          approvedAt: new Date(),
        },
      }
    );

    // Send notifications to all approved users
    const users = await Register.find({
      _id: { $in: userIds },
      registrationStatus: "approved",
    });

    for (const user of users) {
      if (user.fcmToken) {
        try {
          await admin.messaging().send({
            token: user.fcmToken,
            notification: {
              title: "Registration Approved! 🎉",
              body: "Your account has been approved. You can now login.",
            },
            data: {
              type: "registration_approved",
            },
          });
        } catch (fcmError) {
          console.error("FCM notification error for user:", user._id, fcmError);
        }
      }
    }

    res.json({
      success: true,
      message: `${result.modifiedCount} registrations approved successfully`,
      approvedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error("Bulk approval error:", err);
    res.status(500).json({ message: err.message });
  }
};