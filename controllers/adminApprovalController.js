// controllers/adminApprovalController.js
const Register = require('../models/Register');
const admin = require('../config/firebaseAdmin');

// Get pending approvals
exports.getPendingApprovals = async (req, res) => {
  try {
    const pendingUsers = await Register.find({
      approvalStatus: 'pending',
      isVerified: true,
      role: { $in: ['Radnus', 'FSE', 'Distributor', 'Retailer'] }
    }).select('-password -otp -resetOtp').sort({ createdAt: -1 });

    res.json(pendingUsers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Approve user
exports.approveUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;

    const user = await Register.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.approvalStatus !== 'pending') {
      return res.status(400).json({ 
        message: `User already ${user.approvalStatus}` 
      });
    }

    // Update user
    user.approvalStatus = 'approved';
    user.isApproved = true;
    user.approvedBy = adminId;
    user.approvedAt = new Date();
    user.approvalNotes = 'Approved by admin';

    await user.save();

    // Send notification to user
    if (user.fcmToken) {
      try {
        await admin.messaging().send({
          token: user.fcmToken,
          notification: {
            title: '✅ Account Approved!',
            body: `Your ${user.role} account has been approved. You can now log in.`,
          },
          data: {
            type: 'account_approved',
            role: user.role,
          }
        });
      } catch (fcmError) {
        console.error('FCM notification failed:', fcmError);
      }
    }

    res.json({
      success: true,
      message: 'User approved successfully',
      userId: user._id,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        email: user.email
      }
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Reject user
exports.rejectUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const adminId = req.user.id;

    if (!reason) {
      return res.status(400).json({ message: 'Rejection reason required' });
    }

    const user = await Register.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.approvalStatus !== 'pending') {
      return res.status(400).json({ 
        message: `User already ${user.approvalStatus}` 
      });
    }

    // Update user
    user.approvalStatus = 'rejected';
    user.isApproved = false;
    user.approvedBy = adminId;
    user.approvedAt = new Date();
    user.rejectionReason = reason;
    user.approvalNotes = `Rejected: ${reason}`;

    await user.save();

    // Send rejection notification
    if (user.fcmToken) {
      try {
        await admin.messaging().send({
          token: user.fcmToken,
          notification: {
            title: '❌ Registration Rejected',
            body: `Your ${user.role} account was not approved. Reason: ${reason}`,
          },
          data: {
            type: 'account_rejected',
            reason: reason,
          }
        });
      } catch (fcmError) {
        console.error('FCM notification failed:', fcmError);
      }
    }

    res.json({
      success: true,
      message: 'User rejected successfully',
      userId: user._id,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        email: user.email
      }
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get approval status for current user
exports.getApprovalStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await Register.findById(userId)
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
};

// Get all approved users (for admin)
exports.getApprovedUsers = async (req, res) => {
  try {
    const { role } = req.query;
    const filter = { isApproved: true, isVerified: true };
    
    if (role && role !== 'all') {
      filter.role = role;
    }

    const users = await Register.find(filter)
      .select('-password -otp -resetOtp')
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};