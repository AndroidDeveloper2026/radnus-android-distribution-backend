
const mongoose = require('mongoose');
const Register = require('../models/Register');
const admin = require('../config/firebaseAdmin');
const {
  getApproverRoles,
  getChildRoles,
  requiresParentSelection,
  ROLE_LABELS,
} = require('../utils/roleHierarchy');
const { canViewUser } = require('../utils/hierarchyScope');

// Transition switch: accounts created before the hierarchy existed have no
// parentId. While true, approvers can still see/approve those "unassigned"
// accounts (and approving one assigns it to them). Set to false once the
// backfill / Admin assignment is complete.
const ALLOW_LEGACY_UNASSIGNED = true;

const SAFE_FIELDS = '-password -otp -otpExpiry -resetOtp -resetOtpExpiry';

function isValidObjectId(id) {
  return !!id && mongoose.Types.ObjectId.isValid(id);
}

// Build the mongo filter representing "users this approver is allowed to
// see/manage", based on their JWT role. Every approver role (Admin,
// Marketing Manager, Distributor, FSE) sees ALL pending/processed
// requests for their child role(s) — no specific parent/individual is
// pre-assigned during registration.
function buildScopeFilter(reqUser) {
  const childRoles = getChildRoles(reqUser.role);

  if (!childRoles.length) {
    return null; // this role does not approve anyone
  }

  // Admin (no Register id) approves by role only.
  if (reqUser.role === 'Admin' || !isValidObjectId(reqUser.id)) {
    return { role: { $in: childRoles } };
  }

  // Everyone else only sees registrations that picked THEM as superior.
  const scopedRoles = childRoles.filter(requiresParentSelection);
  const openRoles = childRoles.filter((r) => !requiresParentSelection(r));
  const parentMatch = ALLOW_LEGACY_UNASSIGNED ? { $in: [reqUser.id, null] } : reqUser.id;

  const or = [];
  if (openRoles.length) or.push({ role: { $in: openRoles } });
  if (scopedRoles.length) or.push({ role: { $in: scopedRoles }, parentId: parentMatch });

  return or.length === 1 ? or[0] : { $or: or };
}

// GET /api/approvals/pending
exports.getPendingApprovals = async (req, res) => {
  try {
    const filter = buildScopeFilter(req.user);
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
    const filter = buildScopeFilter(req.user);
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

// Shared authorization check: can the requesting JWT user act on `targetUser`?
function isAuthorizedApprover(reqUser, targetUser) {
  if (isValidObjectId(reqUser.id) && targetUser._id.equals(reqUser.id)) {
    return false; // can't approve self
  }

  if (!getApproverRoles(targetUser.role).includes(reqUser.role)) return false;

  // Roles that pick a superior at registration: only THAT superior (or Admin
  // via the admin routes) may approve. Unassigned legacy accounts are allowed
  // while ALLOW_LEGACY_UNASSIGNED is on.
  if (requiresParentSelection(targetUser.role) && reqUser.role !== 'Admin') {
    if (targetUser.parentId) return targetUser.parentId.equals(reqUser.id);
    return ALLOW_LEGACY_UNASSIGNED;
  }
  return true;
}

// POST /api/approvals/approve/:userId
exports.approveUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const targetUser = await Register.findById(userId);
    if (!targetUser) return res.status(404).json({ message: 'Registration request not found' });

    if (!isAuthorizedApprover(req.user, targetUser)) {
      return res.status(403).json({ message: 'You are not authorized to approve this user' });
    }

    if (targetUser.approvalStatus !== 'pending') {
      return res.status(400).json({ message: `User already ${targetUser.approvalStatus}` });
    }

    targetUser.approvalStatus = 'approved';
    targetUser.isApproved = true;
    targetUser.approvedBy = isValidObjectId(req.user.id) ? req.user.id : null;
    // Make sure the approver becomes the superior if none was stored yet.
    if (!targetUser.parentId && isValidObjectId(req.user.id) && requiresParentSelection(targetUser.role)) {
      targetUser.parentId = req.user.id;
    }
    targetUser.approvedAt = new Date();
    targetUser.rejectedAt = null;
    targetUser.rejectionReason = null;
    targetUser.approvalNotes = `Approved by ${ROLE_LABELS[req.user.role] || req.user.role}`;

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

    const targetUser = await Register.findById(userId);
    if (!targetUser) return res.status(404).json({ message: 'Registration request not found' });

    if (!isAuthorizedApprover(req.user, targetUser)) {
      return res.status(403).json({ message: 'You are not authorized to reject this user' });
    }

    if (targetUser.approvalStatus !== 'pending') {
      return res.status(400).json({ message: `User already ${targetUser.approvalStatus}` });
    }

    targetUser.approvalStatus = 'rejected';
    targetUser.isApproved = false;
    targetUser.approvedBy = isValidObjectId(req.user.id) ? req.user.id : null;
    targetUser.rejectedAt = new Date();
    targetUser.rejectionReason = reason;
    targetUser.approvalNotes = `Rejected by ${ROLE_LABELS[req.user.role] || req.user.role}: ${reason}`;

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
    const filter = buildScopeFilter(req.user);
    if (!filter) {
      return res.json([]);
    }

    const users = await Register.find(filter).select(SAFE_FIELDS).sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/approvals/view/:userId — single user detail. Admin can view
// anyone; other approvers can view themselves or any user in a child
// role of theirs (role-based, same as the approval scope).
exports.viewUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    const targetUser = await Register.findById(userId).select(SAFE_FIELDS);
    if (!targetUser) return res.status(404).json({ message: 'User not found' });

    if (req.user.role === 'Admin') {
      return res.json(targetUser);
    }

    const childRoles = getChildRoles(req.user.role);
    const isSelf = isValidObjectId(req.user.id) && targetUser._id.equals(req.user.id);
    const isChildRole = childRoles.includes(targetUser.role);

    if (isSelf || (await canViewUser(req.user, targetUser._id)) || (isChildRole && !targetUser.parentId)) {
      return res.json(targetUser);
    }

    return res.status(403).json({ message: 'You are not authorized to view this user' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

//------------- 05.10.26 Backup ---------------
// const mongoose = require('mongoose');
// const Register = require('../models/Register');
// const admin = require('../config/firebaseAdmin');
// const { getApproverRole, getChildRoles, ROLE_LABELS } = require('../utils/roleHierarchy');

// const SAFE_FIELDS = '-password -otp -otpExpiry -resetOtp -resetOtpExpiry';

// function isValidObjectId(id) {
//   return !!id && mongoose.Types.ObjectId.isValid(id);
// }

// // Build the mongo filter representing "users this approver is allowed to
// // see/manage", based on their JWT role. Every approver role (Admin,
// // Marketing Manager, Distributor, FSE) sees ALL pending/processed
// // requests for their child role(s) — no specific parent/individual is
// // pre-assigned during registration.
// function buildScopeFilter(reqUser) {
//   const childRoles = getChildRoles(reqUser.role);

//   if (!childRoles.length) {
//     return null; // this role does not approve anyone
//   }

//   return { role: { $in: childRoles } };
// }

// // GET /api/approvals/pending
// exports.getPendingApprovals = async (req, res) => {
//   try {
//     const filter = buildScopeFilter(req.user);
//     if (!filter) {
//       return res.status(403).json({ message: 'Your role does not approve any registrations' });
//     }

//     const pendingUsers = await Register.find({ ...filter, approvalStatus: 'pending' })
//       .select(SAFE_FIELDS)
//       .sort({ createdAt: -1 });

//     res.json(pendingUsers);
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

// // GET /api/approvals/processed  (approved + rejected, for history tabs)
// exports.getProcessedApprovals = async (req, res) => {
//   try {
//     const filter = buildScopeFilter(req.user);
//     if (!filter) {
//       return res.status(403).json({ message: 'Your role does not approve any registrations' });
//     }

//     const { status } = req.query; // optional: 'approved' | 'rejected'
//     const statusFilter = status
//       ? { approvalStatus: status }
//       : { approvalStatus: { $in: ['approved', 'rejected'] } };

//     const users = await Register.find({ ...filter, ...statusFilter })
//       .select(SAFE_FIELDS)
//       .sort({ approvedAt: -1, rejectedAt: -1, createdAt: -1 });

//     res.json(users);
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

// // Shared authorization check: can the requesting JWT user act on `targetUser`?
// function isAuthorizedApprover(reqUser, targetUser) {
//   if (isValidObjectId(reqUser.id) && targetUser._id.equals(reqUser.id)) {
//     return false; // can't approve self
//   }

//   const expectedApproverRole = getApproverRole(targetUser.role);
//   if (expectedApproverRole !== reqUser.role) return false;

//   // Any user holding the correct approver role may act on this request —
//   // visibility/authorization is role-based, not assigned-individual-based.
//   return true;
// }

// // POST /api/approvals/approve/:userId
// exports.approveUser = async (req, res) => {
//   try {
//     const { userId } = req.params;

//     const targetUser = await Register.findById(userId);
//     if (!targetUser) return res.status(404).json({ message: 'Registration request not found' });

//     if (!isAuthorizedApprover(req.user, targetUser)) {
//       return res.status(403).json({ message: 'You are not authorized to approve this user' });
//     }

//     if (targetUser.approvalStatus !== 'pending') {
//       return res.status(400).json({ message: `User already ${targetUser.approvalStatus}` });
//     }

//     targetUser.approvalStatus = 'approved';
//     targetUser.isApproved = true;
//     targetUser.approvedBy = isValidObjectId(req.user.id) ? req.user.id : null;
//     targetUser.approvedAt = new Date();
//     targetUser.rejectedAt = null;
//     targetUser.rejectionReason = null;
//     targetUser.approvalNotes = `Approved by ${ROLE_LABELS[req.user.role] || req.user.role}`;

//     await targetUser.save();

//     if (targetUser.fcmToken) {
//       try {
//         await admin.messaging().send({
//           token: targetUser.fcmToken,
//           notification: {
//             title: '✅ Account Approved!',
//             body: `Your ${ROLE_LABELS[targetUser.role] || targetUser.role} account has been approved. You can now log in.`,
//           },
//           data: { type: 'account_approved', role: targetUser.role },
//         });
//       } catch (fcmError) {
//         console.error('FCM notification failed:', fcmError);
//       }
//     }

//     res.json({
//       success: true,
//       message: 'User approved successfully',
//       userId: targetUser._id,
//       user: {
//         id: targetUser._id,
//         name: targetUser.name,
//         role: targetUser.role,
//         email: targetUser.email,
//       },
//     });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

// // POST /api/approvals/reject/:userId
// exports.rejectUser = async (req, res) => {
//   try {
//     const { userId } = req.params;
//     const { reason } = req.body;

//     if (!reason) {
//       return res.status(400).json({ message: 'Rejection reason required' });
//     }

//     const targetUser = await Register.findById(userId);
//     if (!targetUser) return res.status(404).json({ message: 'Registration request not found' });

//     if (!isAuthorizedApprover(req.user, targetUser)) {
//       return res.status(403).json({ message: 'You are not authorized to reject this user' });
//     }

//     if (targetUser.approvalStatus !== 'pending') {
//       return res.status(400).json({ message: `User already ${targetUser.approvalStatus}` });
//     }

//     targetUser.approvalStatus = 'rejected';
//     targetUser.isApproved = false;
//     targetUser.approvedBy = isValidObjectId(req.user.id) ? req.user.id : null;
//     targetUser.rejectedAt = new Date();
//     targetUser.rejectionReason = reason;
//     targetUser.approvalNotes = `Rejected by ${ROLE_LABELS[req.user.role] || req.user.role}: ${reason}`;

//     await targetUser.save();

//     if (targetUser.fcmToken) {
//       try {
//         await admin.messaging().send({
//           token: targetUser.fcmToken,
//           notification: {
//             title: '❌ Registration Rejected',
//             body: `Your ${ROLE_LABELS[targetUser.role] || targetUser.role} account was not approved. Reason: ${reason}`,
//           },
//           data: { type: 'account_rejected', reason },
//         });
//       } catch (fcmError) {
//         console.error('FCM notification failed:', fcmError);
//       }
//     }

//     res.json({
//       success: true,
//       message: 'User rejected successfully',
//       userId: targetUser._id,
//       user: {
//         id: targetUser._id,
//         name: targetUser.name,
//         role: targetUser.role,
//         email: targetUser.email,
//       },
//     });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

// // GET /api/approvals/my-team  — users directly below the logged-in
// // approver in the hierarchy (any status), for management dashboards.
// exports.getMyTeam = async (req, res) => {
//   try {
//     const filter = buildScopeFilter(req.user);
//     if (!filter) {
//       return res.json([]);
//     }

//     const users = await Register.find(filter).select(SAFE_FIELDS).sort({ createdAt: -1 });
//     res.json(users);
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

// // GET /api/approvals/view/:userId — single user detail. Admin can view
// // anyone; other approvers can view themselves or any user in a child
// // role of theirs (role-based, same as the approval scope).
// exports.viewUserDetails = async (req, res) => {
//   try {
//     const { userId } = req.params;

//     const targetUser = await Register.findById(userId).select(SAFE_FIELDS);
//     if (!targetUser) return res.status(404).json({ message: 'User not found' });

//     if (req.user.role === 'Admin') {
//       return res.json(targetUser);
//     }

//     const childRoles = getChildRoles(req.user.role);
//     const isSelf = isValidObjectId(req.user.id) && targetUser._id.equals(req.user.id);
//     const isChildRole = childRoles.includes(targetUser.role);

//     if (isSelf || isChildRole) {
//       return res.json(targetUser);
//     }

//     return res.status(403).json({ message: 'You are not authorized to view this user' });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

