const Register = require('../models/Register');
const admin = require('../config/firebaseAdmin');
const { getApproverRole, getChildRoles, ROLE_LABELS } = require('../utils/roleHierarchy');

const SAFE_FIELDS = '-password -otp -otpExpiry -resetOtp -resetOtpExpiry';

// Build the mongo filter representing "users this approver is allowed to
// see/manage", based on their role and hierarchy position.
function buildScopeFilter(approver) {
  const childRoles = getChildRoles(approver.role);

  if (!childRoles.length) {
    return null; // this role does not approve anyone
  }

  if (approver.role === 'Admin') {
    // Admin approves Radnus Employees and Marketing Managers system-wide
    // (no specific parent selection happens for these roles).
    return { role: { $in: childRoles } };
  }

  // Every other approver only manages users who explicitly chose them
  // as their parent during registration.
  return { role: { $in: childRoles }, parentId: approver._id };
}

// GET /api/approvals/pending
exports.getPendingApprovals = async (req, res) => {
  try {
    const approver = await Register.findById(req.user.id);
    if (!approver) return res.status(404).json({ message: 'User not found' });

    const filter = buildScopeFilter(approver);
    if (!filter) {
      return res.status(403).json({ message: 'Your role does not approve any registrations' });
    }

    const pendingUsers = await Register.find({ ...filter, approvalStatus: 'pending' })
      .select(SAFE_FIELDS)
      .sort({ createdAt: -1 });

    res.json(pendingUsers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/approvals/processed  (approved + rejected, for history tabs)
exports.getProcessedApprovals = async (req, res) => {
  try {
    const approver = await Register.findById(req.user.id);
    if (!approver) return res.status(404).json({ message: 'User not found' });

    const filter = buildScopeFilter(approver);
    if (!filter) {
      return res.status(403).json({ message: 'Your role does not approve any registrations' });
    }

    const { status } = req.query; // optional: 'approved' | 'rejected'
    const statusFilter = status
      ? { approvalStatus: status }
      : { approvalStatus: { $in: ['approved', 'rejected'] } };

    const users = await Register.find({ ...filter, ...statusFilter })
      .select(SAFE_FIELDS)
      .sort({ approvedAt: -1, rejectedAt: -1, createdAt: -1 });

    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Shared authorization check: can `approver` act on `targetUser`?
function isAuthorizedApprover(approver, targetUser) {
  if (approver._id.equals(targetUser._id)) return false; // can't approve self
  const expectedApproverRole = getApproverRole(targetUser.role);
  if (expectedApproverRole !== approver.role) return false;

  if (approver.role === 'Admin') {
    return true; // Admin can approve any Radnus/MarketingManager request
  }

  // All other approvers may only act on users who picked them as parent
  return targetUser.parentId && targetUser.parentId.equals(approver._id);
}

// POST /api/approvals/approve/:userId
exports.approveUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const approver = await Register.findById(req.user.id);
    if (!approver) return res.status(404).json({ message: 'User not found' });

    const targetUser = await Register.findById(userId);
    if (!targetUser) return res.status(404).json({ message: 'Registration request not found' });

    if (!isAuthorizedApprover(approver, targetUser)) {
      return res.status(403).json({ message: 'You are not authorized to approve this user' });
    }

    if (targetUser.approvalStatus !== 'pending') {
      return res.status(400).json({ message: `User already ${targetUser.approvalStatus}` });
    }

    targetUser.approvalStatus = 'approved';
    targetUser.isApproved = true;
    targetUser.approvedBy = approver._id;
    targetUser.approvedAt = new Date();
    targetUser.rejectedAt = null;
    targetUser.rejectionReason = null;
    targetUser.approvalNotes = `Approved by ${ROLE_LABELS[approver.role] || approver.role}`;

    await targetUser.save();

    if (targetUser.fcmToken) {
      try {
        await admin.messaging().send({
          token: targetUser.fcmToken,
          notification: {
            title: '✅ Account Approved!',
            body: `Your ${ROLE_LABELS[targetUser.role] || targetUser.role} account has been approved. You can now log in.`,
          },
          data: { type: 'account_approved', role: targetUser.role },
        });
      } catch (fcmError) {
        console.error('FCM notification failed:', fcmError);
      }
    }

    res.json({
      success: true,
      message: 'User approved successfully',
      userId: targetUser._id,
      user: {
        id: targetUser._id,
        name: targetUser.name,
        role: targetUser.role,
        email: targetUser.email,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/approvals/reject/:userId
exports.rejectUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ message: 'Rejection reason required' });
    }

    const approver = await Register.findById(req.user.id);
    if (!approver) return res.status(404).json({ message: 'User not found' });

    const targetUser = await Register.findById(userId);
    if (!targetUser) return res.status(404).json({ message: 'Registration request not found' });

    if (!isAuthorizedApprover(approver, targetUser)) {
      return res.status(403).json({ message: 'You are not authorized to reject this user' });
    }

    if (targetUser.approvalStatus !== 'pending') {
      return res.status(400).json({ message: `User already ${targetUser.approvalStatus}` });
    }

    targetUser.approvalStatus = 'rejected';
    targetUser.isApproved = false;
    targetUser.approvedBy = approver._id;
    targetUser.rejectedAt = new Date();
    targetUser.rejectionReason = reason;
    targetUser.approvalNotes = `Rejected by ${ROLE_LABELS[approver.role] || approver.role}: ${reason}`;

    await targetUser.save();

    if (targetUser.fcmToken) {
      try {
        await admin.messaging().send({
          token: targetUser.fcmToken,
          notification: {
            title: '❌ Registration Rejected',
            body: `Your ${ROLE_LABELS[targetUser.role] || targetUser.role} account was not approved. Reason: ${reason}`,
          },
          data: { type: 'account_rejected', reason },
        });
      } catch (fcmError) {
        console.error('FCM notification failed:', fcmError);
      }
    }

    res.json({
      success: true,
      message: 'User rejected successfully',
      userId: targetUser._id,
      user: {
        id: targetUser._id,
        name: targetUser.name,
        role: targetUser.role,
        email: targetUser.email,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/approvals/my-team  — users directly below the logged-in
// approver in the hierarchy (any status), for management dashboards.
exports.getMyTeam = async (req, res) => {
  try {
    const approver = await Register.findById(req.user.id);
    if (!approver) return res.status(404).json({ message: 'User not found' });

    const filter = buildScopeFilter(approver);
    if (!filter) {
      return res.json([]);
    }

    const users = await Register.find(filter).select(SAFE_FIELDS).sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/approvals/view/:userId — single user detail, scoped so an
// approver can only view users within their own hierarchy branch
// (Admin can view anyone).
exports.viewUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const approver = await Register.findById(req.user.id);
    if (!approver) return res.status(404).json({ message: 'User not found' });

    const targetUser = await Register.findById(userId).select(SAFE_FIELDS);
    if (!targetUser) return res.status(404).json({ message: 'User not found' });

    if (approver.role === 'Admin') {
      return res.json(targetUser);
    }

    if (
      targetUser._id.equals(approver._id) ||
      (targetUser.parentId && targetUser.parentId.equals(approver._id))
    ) {
      return res.json(targetUser);
    }

    return res.status(403).json({ message: 'You are not authorized to view this user' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
