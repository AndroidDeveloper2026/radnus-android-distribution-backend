// routes/teamRoutes.js  (mounted at /api/team, behind authMiddleware)
// What a superior sees: the people below them + today's tracking status.
const express = require('express');
const router = express.Router();
const Register = require('../models/Register');
const Session = require('../models/FSEModel/Session');
const { getSubordinateIds } = require('../utils/hierarchyScope');
const { istDayRange } = require('../utils/dayRange');
const { TRACKED_ROLES } = require('../utils/roleHierarchy');

// Admin & Radnus are not tracked, but Admin may view everyone.
// Radnus has no team view at all.
function canUseTeamView(user) {
  return user && (user.role === 'Admin' || TRACKED_ROLES.includes(user.role));
}

function todayStatus(session) {
  if (!session) return 'NOT_STARTED';
  return session.status === 'ACTIVE' ? 'ACTIVE' : 'ENDED';
}

// GET /api/team/members?role=FSE&q=ravi
// -> { members: [...], summary: {...} }
router.get('/members', async (req, res) => {
  try {
    if (!canUseTeamView(req.user)) {
      return res.status(403).json({ message: 'Team tracking is not available for your role' });
    }

    const ids = await getSubordinateIds(req.user);
    if (!ids.length) {
      return res.json({
        members: [],
        summary: { total: 0, active: 0, ended: 0, notStarted: 0, totalDistanceKm: 0 },
      });
    }

    const userFilter = { _id: { $in: ids } };
    if (req.query.role && TRACKED_ROLES.includes(req.query.role)) userFilter.role = req.query.role;
    if (req.query.q) {
      const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      userFilter.$or = [{ name: rx }, { mobile: rx }];
    }

    const { start, end } = istDayRange();
    const users = await Register.find(userFilter)
      .select('name role mobile district taluk parentId isActive')
      .populate('parentId', 'name role')
      .sort({ role: 1, name: 1 })
      .lean();

    const sessions = await Session.find(
      { userId: { $in: users.map((u) => String(u._id)) }, startTime: { $gte: start, $lt: end } },
      { route: { $slice: -1 } }, // last route point only – keeps the payload small
    )
      .sort({ startTime: -1 })
      .lean();

    // newest session of the day per user
    const byUser = new Map();
    for (const s of sessions) if (!byUser.has(String(s.userId))) byUser.set(String(s.userId), s);

    const members = users.map((u) => {
      const s = byUser.get(String(u._id));
      const last = s && s.route && s.route[0];
      return {
        _id: u._id,
        name: u.name,
        role: u.role,
        mobile: u.mobile,
        district: u.district,
        taluk: u.taluk,
        isActive: u.isActive !== false,
        parent: u.parentId ? { _id: u.parentId._id, name: u.parentId.name, role: u.parentId.role } : null,
        status: todayStatus(s),
        today: s
          ? {
              sessionId: s._id,
              status: s.status,
              startTime: s.startTime,
              endTime: s.endTime || null,
              totalDistanceKm: s.totalDistanceKm || 0,
              pointCount: s.pointCount || 0,
              lastLocation: last
                ? { latitude: last.latitude, longitude: last.longitude, timestamp: last.timestamp }
                : null,
            }
          : null,
      };
    });

    const summary = members.reduce(
      (acc, m) => {
        acc.total += 1;
        if (m.status === 'ACTIVE') acc.active += 1;
        else if (m.status === 'ENDED') acc.ended += 1;
        else acc.notStarted += 1;
        acc.totalDistanceKm += (m.today && m.today.totalDistanceKm) || 0;
        return acc;
      },
      { total: 0, active: 0, ended: 0, notStarted: 0, totalDistanceKm: 0 },
    );
    summary.totalDistanceKm = Math.round(summary.totalDistanceKm * 100) / 100;

    res.json({ members, summary });
  } catch (err) {
    console.error('❌ /team/members error:', err.message);
    res.status(500).json({ message: 'Error loading team', error: err.message });
  }
});

// GET /api/team/live  -> last known position of everyone ACTIVE today in my scope
router.get('/live', async (req, res) => {
  try {
    if (!canUseTeamView(req.user)) {
      return res.status(403).json({ message: 'Team tracking is not available for your role' });
    }
    const ids = await getSubordinateIds(req.user);
    if (!ids.length) return res.json({ live: [] });

    const { start, end } = istDayRange();
    const sessions = await Session.find(
      { userId: { $in: ids }, status: 'ACTIVE', startTime: { $gte: start, $lt: end } },
      { route: { $slice: -1 } },
    ).lean();

    const users = await Register.find({ _id: { $in: sessions.map((s) => s.userId) } })
      .select('name role')
      .lean();
    const nameById = new Map(users.map((u) => [String(u._id), u]));

    const live = sessions
      .map((s) => {
        const last = s.route && s.route[0];
        const u = nameById.get(String(s.userId));
        if (!last) return null;
        return {
          userId: String(s.userId),
          name: u ? u.name : 'Unknown',
          role: u ? u.role : null,
          sessionId: String(s._id),
          latitude: last.latitude,
          longitude: last.longitude,
          timestamp: last.timestamp,
          totalDistanceKm: s.totalDistanceKm || 0,
        };
      })
      .filter(Boolean);

    res.json({ live });
  } catch (err) {
    console.error('❌ /team/live error:', err.message);
    res.status(500).json({ message: 'Error loading live team', error: err.message });
  }
});

module.exports = router;
