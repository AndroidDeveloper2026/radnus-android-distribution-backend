// middleware/hierarchyAccess.js
// Route guards for the tracking endpoints. Always used AFTER authMiddleware
// (which sets req.user = { id, role, name }).
const mongoose = require('mongoose');
const Session = require('../models/FSEModel/Session');
const { TRACKED_ROLES } = require('../utils/roleHierarchy');
const { canViewUser } = require('../utils/hierarchyScope');

// Only roles that travel may start/end a day or push GPS points.
// Admin and Radnus are rejected here.
function requireTrackedRole(req, res, next) {
  if (
    !req.user ||
    !TRACKED_ROLES.includes(req.user.role) ||
    !mongoose.Types.ObjectId.isValid(String(req.user.id || ''))
  ) {
    return res
      .status(403)
      .json({ message: 'Tracking is not enabled for your role', permanent: true });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'Admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

// Route has :userId – caller must be that user or one of their superiors/Admin.
async function requireUserAccess(req, res, next) {
  try {
    const targetId = req.params.userId;
    if (!(await canViewUser(req.user, targetId))) {
      return res.status(403).json({ message: 'You are not allowed to view this user' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

// Route has :sessionId (or custom param) – same rule, resolved via the session owner.
const requireSessionAccess = (param = 'sessionId') => async (req, res, next) => {
  try {
    const sessionId = req.params[param];
    if (!mongoose.Types.ObjectId.isValid(String(sessionId))) {
      return res.status(400).json({ message: 'Invalid session id' });
    }
    const s = await Session.findById(sessionId).select('userId').lean();
    if (!s) return res.status(404).json({ message: 'Session not found' });
    if (!(await canViewUser(req.user, s.userId))) {
      return res.status(403).json({ message: 'You are not allowed to view this session' });
    }
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireTrackedRole, requireAdmin, requireUserAccess, requireSessionAccess };
