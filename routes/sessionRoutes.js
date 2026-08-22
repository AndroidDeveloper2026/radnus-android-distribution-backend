
/**
 * sessionRoutes.js
 *
 * Endpoints
 * ─────────
 *  POST  /api/session/start           — create a new ACTIVE session
 *  POST  /api/session/end/:sessionId  — mark session ENDED, rebuild route
 *  POST  /api/session/rebuild/:id     — manual route rebuild from Location docs
 *  GET   /api/session/                — list sessions (paginated, filterable)
 *  GET   /api/session/today/:userId   — today's session for an FSE
 *  GET   /api/session/orphaned/:userId — stale ACTIVE session from a previous day
 *  GET   /api/session/:sessionId      — full session with route snapshot
 */

'use strict';

const express           = require('express');
const router            = express.Router();
const Session           = require('../models/FSEModel/Session');
const Location          = require('../models/LocationModel/Location');
const calculateDistance = require('../utils/distance');
const { runExclusive }  = require('../utils/sessionLock');

// ─── Helpers ─────────────────────────────────────────────────────────────────
function startOfToday() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}

function isFromPreviousDay(date) {
  return new Date(date) < startOfToday();
}

// ─── Route snapshot rebuild ────────────────────────────────────────────────
async function rebuildRoute(sessionId) {
  const locs = await Location.find({ sessionId })
    .sort({ timestamp: 1 })
    .lean();

  if (!locs.length) return null;

  let dist = 0;
  for (let i = 1; i < locs.length; i++) {
    dist += calculateDistance(
      locs[i - 1].latitude, locs[i - 1].longitude,
      locs[i].latitude,     locs[i].longitude,
    );
  }

  return Session.findByIdAndUpdate(
    sessionId,
    {
      route:           locs.map(l => ({ latitude: l.latitude, longitude: l.longitude, timestamp: l.timestamp })),
      totalDistanceKm: parseFloat(dist.toFixed(4)),
      pointCount:      locs.length,
    },
    { new: true },
  );
}

// ─── Auto-end stale sessions (runs at startup + hourly) ───────────────────
async function autoEndStaleSessions() {
  try {
    const stale = await Session.find({
      status:    'ACTIVE',
      startTime: { $lt: startOfToday() },
    });

    for (const s of stale) {
      await runExclusive(s._id, async () => {
        const fresh = await Session.findById(s._id);
        if (!fresh || fresh.status !== 'ACTIVE') return;
        const rebuilt = await rebuildRoute(s._id);
        const final   = rebuilt || fresh;
        final.status  = 'AUTO_ENDED';
        final.endTime = final.endTime || new Date();
        await final.save();
        console.log(`[sessionRoutes] Auto-ended stale session ${s._id}`);
      });
    }
  } catch (err) {
    console.error('[sessionRoutes] autoEndStaleSessions error:', err.message);
  }
}

autoEndStaleSessions();
setInterval(autoEndStaleSessions, 60 * 60 * 1000);

// ─── POST /start ──────────────────────────────────────────────────────────────
router.post('/start', async (req, res) => {
  try {
    const { userId, latitude, longitude } = req.body;

    if (!userId || latitude == null || longitude == null)
      return res.status(400).json({ message: 'userId, latitude, longitude required' });

    // Guard: reject if there is already an ACTIVE session today
    const existing = await Session.findOne({
      userId,
      status:    'ACTIVE',
      startTime: { $gte: startOfToday() },
    });
    if (existing)
      return res.status(409).json({
        message:   'Active session already exists for today',
        sessionId: existing._id,
        session:   existing,
      });

    const session = await Session.create({
      userId,
      startLocation: { latitude: parseFloat(latitude), longitude: parseFloat(longitude) },
      status:        'ACTIVE',
      startTime:     new Date(),
      route:         [],
      totalDistanceKm: 0,
      pointCount:      0,
    });

    console.log(`[sessionRoutes] ✅  Session started: ${session._id} for user ${userId}`);
    return res.status(201).json(session);
  } catch (err) {
    console.error('[sessionRoutes] /start error:', err.message);
    return res.status(500).json({ message: 'Error starting session', error: err.message });
  }
});

// ─── POST /end/:sessionId ─────────────────────────────────────────────────────
router.post('/end/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await Session.findById(sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    if (session.status === 'ENDED')
      return res.status(200).json({ message: 'Session already ended', session });

    // Rebuild route one final time to get accurate distance
    const rebuilt = await rebuildRoute(sessionId);
    const final   = rebuilt || session;

    final.status  = 'ENDED';
    final.endTime = new Date();
    await final.save();

    console.log(
      `[sessionRoutes] ✅  Session ended: ${sessionId} ` +
      `pts=${final.pointCount} dist=${final.totalDistanceKm}km`,
    );
    return res.json(final);
  } catch (err) {
    console.error('[sessionRoutes] /end error:', err.message);
    return res.status(500).json({ message: 'Error ending session', error: err.message });
  }
});

// ─── POST /rebuild/:sessionId ────────────────────────────────────────────────
// Manual trigger for route rebuild — called by FSETracking "Refresh Route" button.
router.post('/rebuild/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const rebuilt = await rebuildRoute(sessionId);
    if (!rebuilt) return res.status(404).json({ message: 'No locations found for session' });
    return res.json({
      message:         'Route rebuilt successfully',
      pointCount:      rebuilt.pointCount,
      totalDistanceKm: rebuilt.totalDistanceKm,
    });
  } catch (err) {
    console.error('[sessionRoutes] /rebuild error:', err.message);
    return res.status(500).json({ message: 'Error rebuilding route', error: err.message });
  }
});

// ─── GET / (list) ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const page    = Math.max(parseInt(req.query.page,  10) || 1, 1);
    const limit   = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const skip    = (page - 1) * limit;
    const filter  = {};
    if (req.query.userId) filter.userId = req.query.userId;
    if (req.query.status) filter.status = req.query.status;

    const [sessions, total] = await Promise.all([
      Session.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-route'),          // omit large route array from list view
      Session.countDocuments(filter),
    ]);

    return res.json({
      success:  true,
      sessions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[sessionRoutes] GET / error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /today/:userId ───────────────────────────────────────────────────────
router.get('/today/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ message: 'userId is required' });

    const today  = startOfToday();
    const endDay = new Date(today); endDay.setHours(23, 59, 59, 999);

    const session = await Session.findOne({
      userId,
      status:    { $in: ['ACTIVE', 'AUTO_ENDED'] },
      startTime: { $gte: today, $lte: endDay },
    });

    if (!session) return res.status(404).json({ message: 'No active session today' });

    const rebuilt = await rebuildRoute(session._id);
    return res.json(rebuilt || session);
  } catch (err) {
    console.error('[sessionRoutes] /today error:', err.message);
    return res.status(500).json({ message: 'Error checking today session', error: err.message });
  }
});

// ─── GET /orphaned/:userId ────────────────────────────────────────────────────
// Returns an ACTIVE session that started before today (i.e. app crashed yesterday).
router.get('/orphaned/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ message: 'userId is required' });

    const orphaned = await Session.findOne({
      userId,
      status:    'ACTIVE',
      startTime: { $lt: startOfToday() },
    });

    if (!orphaned) return res.status(404).json({ message: 'No orphaned session' });
    return res.json(orphaned);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ─── GET /:sessionId ─────────────────────────────────────────────────────────
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await Session.findById(sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });

    // Always rebuild for ACTIVE sessions so the route is up to date
    if (session.status === 'ACTIVE') {
      const rebuilt = await rebuildRoute(sessionId);
      return res.json(rebuilt || session);
    }

    return res.json(session);
  } catch (err) {
    console.error('[sessionRoutes] /:id GET error:', err.message);
    return res.status(500).json({ message: 'Error fetching session', error: err.message });
  }
});

module.exports = router;

//--------------- 17.08.2026 ------------------------------
// // sessionRoutes.js - COMPLETE FIXED VERSION

// const express = require('express');
// const router = express.Router();
// const Session = require('../models/FSEModel/Session');
// const Location = require('../models/LocationModel/Location');
// const calculateDistance = require('../utils/distance');
// const { runExclusive } = require('../utils/sessionLock');

// const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// function getStartOfToday() {
//   const d = new Date();
//   d.setHours(0, 0, 0, 0);
//   return d;
// }

// function isFromPreviousDay(date) {
//   return new Date(date) < getStartOfToday();
// }

// // ─── Route rebuild helper ──────────────────────────────────────────────
// async function rebuildSessionRoute(sessionId) {
//   try {
//     const locations = await Location.find({ sessionId })
//       .sort({ timestamp: 1 })
//       .lean();

//     if (locations.length === 0) {
//       return null;
//     }

//     let totalDistance = 0;
//     for (let i = 1; i < locations.length; i++) {
//       const prev = locations[i - 1];
//       const curr = locations[i];
//       totalDistance += calculateDistance(
//         prev.latitude, prev.longitude,
//         curr.latitude, curr.longitude
//       );
//     }

//     const route = locations.map(l => ({
//       latitude: l.latitude,
//       longitude: l.longitude,
//       timestamp: l.timestamp,
//     }));

//     const updatedSession = await Session.findByIdAndUpdate(
//       sessionId,
//       {
//         route: route,
//         totalDistanceKm: parseFloat(totalDistance.toFixed(4)),
//         pointCount: locations.length,
//       },
//       { new: true }
//     );

//     console.log(`🔄 Route rebuilt: ${locations.length} points, ${totalDistance.toFixed(4)}km`);
//     return updatedSession;
//   } catch (err) {
//     console.error(`❌ Failed to rebuild route:`, err.message);
//     return null;
//   }
// }

// // ─── Auto-end stale sessions ────────────────────────────────────────────
// async function autoEndSessionIfStale(session) {
//   if (!session || session.status !== 'ACTIVE') return session;
//   if (!isFromPreviousDay(session.startTime)) return session;

//   return runExclusive(session._id, async () => {
//     const fresh = await Session.findById(session._id);
//     if (!fresh || fresh.status !== 'ACTIVE') return fresh || session;

//     // ✅ Rebuild route before ending
//     const rebuilt = await rebuildSessionRoute(session._id);
//     const finalSession = rebuilt || fresh;

//     finalSession.status = 'AUTO_ENDED';
//     finalSession.endTime = finalSession.endTime || new Date();
//     await finalSession.save();

//     console.log(`🧹 Auto-ended session ${finalSession._id}`);
//     return finalSession;
//   });
// }

// async function cleanupStaleSessions() {
//   try {
//     const staleSessions = await Session.find({
//       status: 'ACTIVE',
//       startTime: { $lt: getStartOfToday() }
//     });

//     for (const session of staleSessions) {
//       await autoEndSessionIfStale(session);
//     }
//   } catch (err) {
//     console.log('❌ Error during stale session cleanup:', err.message);
//   }
// }

// cleanupStaleSessions();
// setInterval(cleanupStaleSessions, CLEANUP_INTERVAL_MS);

// // ─── GET ALL SESSIONS ────────────────────────────────────────────────────
// router.get('/', async (req, res) => {
//   try {
//     const page = parseInt(req.query.page, 10) || 1;
//     const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
//     const skip = (page - 1) * limit;
//     const { userId, status } = req.query;
//     const filter = {};
//     if (userId) filter.userId = userId;
//     if (status) filter.status = status;

//     const [sessions, total] = await Promise.all([
//       Session.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-route'),
//       Session.countDocuments(filter),
//     ]);

//     res.status(200).json({
//       success: true,
//       sessions,
//       pagination: {
//         page,
//         limit,
//         total,
//         totalPages: Math.ceil(total / limit),
//       },
//     });
//   } catch (err) {
//     console.log('❌ Error fetching sessions:', err.message);
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

// // ─── CHECK TODAY'S SESSION ──────────────────────────────────────────────
// router.get('/today/:userId', async (req, res) => {
//   try {
//     const { userId } = req.params;
//     if (!userId) {
//       return res.status(400).json({ message: 'userId is required' });
//     }

//     const startOfDay = getStartOfToday();
//     const endOfDay = new Date();
//     endOfDay.setHours(23, 59, 59, 999);

//     const session = await Session.findOne({
//       userId,
//       status: { $in: ['ACTIVE', 'AUTO_ENDED'] },
//       startTime: { $gte: startOfDay, $lte: endOfDay },
//     });

//     if (!session) {
//       return res.status(404).json({ message: 'No active session today' });
//     }

//     // ✅ Rebuild route before returning
//     if (session.status === 'ACTIVE') {
//       const rebuilt = await rebuildSessionRoute(session._id);
//       if (rebuilt) {
//         return res.json(rebuilt);
//       }
//     }

//     res.json(session);
//   } catch (err) {
//     console.log('❌ Error in /today/:userId:', err);
//     res.status(500).json({ message: 'Error checking session', error: err.message });
//   }
// });

// // ─── ORPHANED SESSION CHECK ─────────────────────────────────────────────
// router.get('/orphaned/:userId', async (req, res) => {
//   try {
//     const { userId } = req.params;
//     if (!userId) {
//       return res.status(400).json({ message: 'userId is required' });
//     }

//     const orphaned = await Session.findOne({
//       userId,
//       status: 'ACTIVE',
//       startTime: { $lt: getStartOfToday() }
//     });

//     if (!orphaned) {
//       return res.status(404).json({ message: 'No orphaned session found' });
//     }

//     // ✅ Rebuild route before returning
//     const rebuilt = await rebuildSessionRoute(orphaned._id);
//     res.json(rebuilt || orphaned);
//   } catch (err) {
//     console.log('❌ Error checking orphaned session:', err.message);
//     res.status(500).json({ message: 'Error checking orphaned session', error: err.message });
//   }
// });

// // ─── START SESSION ──────────────────────────────────────────────────────
// router.post('/start', async (req, res) => {
//   try {
//     const { userId, latitude, longitude } = req.body;

//     if (!userId || userId.toString().trim() === '') {
//       return res.status(400).json({ message: 'userId is required' });
//     }
//     if (latitude === undefined || latitude === null || latitude === '') {
//       return res.status(400).json({ message: 'latitude is required' });
//     }
//     if (longitude === undefined || longitude === null || longitude === '') {
//       return res.status(400).json({ message: 'longitude is required' });
//     }

//     const lat = parseFloat(latitude);
//     const lng = parseFloat(longitude);
//     if (isNaN(lat) || isNaN(lng)) {
//       return res.status(400).json({ message: 'latitude and longitude must be valid numbers' });
//     }

//     const startOfDay = getStartOfToday();
//     const endOfDay = new Date();
//     endOfDay.setHours(23, 59, 59, 999);

//     const existingSession = await Session.findOne({
//       userId,
//       status: { $in: ['ACTIVE', 'AUTO_ENDED'] },
//       startTime: { $gte: startOfDay, $lte: endOfDay },
//     });

//     if (existingSession) {
//       console.log(`⚠️ Session already exists for today - sessionId: ${existingSession._id}`);
//       return res.json(existingSession);
//     }

//     const lockedStartLocation = { latitude: lat, longitude: lng };

//     const session = new Session({
//       userId,
//       startLocation: lockedStartLocation,
//       route: [{ latitude: lat, longitude: lng, timestamp: new Date() }],
//       status: 'ACTIVE',
//       totalDistanceKm: 0,
//       pointCount: 1,
//     });

//     const savedSession = await session.save();
//     console.log(`✅ Session created - sessionId: ${savedSession._id}`);

//     // ✅ Save start point to Location collection
//     try {
//       await Location.create({
//         userId,
//         sessionId: savedSession._id,
//         latitude: lat,
//         longitude: lng,
//         timestamp: savedSession.startTime,
//       });
//       console.log(`✅ Start point saved to Location for session ${savedSession._id}`);
//     } catch (locErr) {
//       console.error('⚠️ Could not save start point to Location:', locErr.message);
//     }

//     res.status(201).json(savedSession);
//   } catch (err) {
//     console.log('❌ ERROR in /start:', err.message);
//     res.status(500).json({
//       message: 'Error starting session',
//       error: err.message,
//       details: err.name === 'ValidationError' ? err.errors : null,
//     });
//   }
// });

// // ─── END SESSION ────────────────────────────────────────────────────────
// router.post('/end', async (req, res) => {
//   try {
//     const { sessionId, finalLocation } = req.body;
//     if (!sessionId) {
//       return res.status(400).json({ message: 'Session ID required' });
//     }

//     console.log(`📤 Ending session: ${sessionId}`);

//     const session = await runExclusive(sessionId, async () => {
//       // ✅ Save final location if provided
//       if (finalLocation && finalLocation.latitude && finalLocation.longitude) {
//         try {
//           const existing = await Session.findById(sessionId).select('userId').lean();
//           if (existing) {
//             await Location.create({
//               userId: existing.userId,
//               sessionId,
//               latitude: finalLocation.latitude,
//               longitude: finalLocation.longitude,
//               timestamp: new Date(),
//             });
//             console.log('✅ Final location saved');
//           }
//         } catch (locErr) {
//           console.error('⚠️ Could not save final location:', locErr.message);
//         }
//       }

//       // ✅ Rebuild route from Location collection
//       const rebuilt = await rebuildSessionRoute(sessionId);
//       if (rebuilt) {
//         // Update status to ENDED
//         const updated = await Session.findByIdAndUpdate(
//           sessionId,
//           {
//             status: 'ENDED',
//             endTime: new Date(),
//           },
//           { new: true }
//         );
//         return updated;
//       }

//       // Fallback if rebuild fails
//       const updated = await Session.findByIdAndUpdate(
//         sessionId,
//         {
//           status: 'ENDED',
//           endTime: new Date(),
//         },
//         { new: true }
//       );
//       return updated;
//     });

//     if (!session) {
//       return res.status(404).json({ message: 'Session not found' });
//     }

//     console.log(`✅ Session ended - ${sessionId}, Distance: ${session.totalDistanceKm}km, Points: ${session.pointCount}`);
//     res.json(session);
//   } catch (err) {
//     console.error('❌ Error ending session:', err.message);
//     res.status(500).json({ message: 'Error ending session', error: err.message });
//   }
// });

// // ─── GET SESSION BY ID ──────────────────────────────────────────────────
// router.get('/:sessionId', async (req, res) => {
//   try {
//     const { sessionId } = req.params;
//     const routePage = parseInt(req.query.routePage, 10) || null;
//     const routeLimit = Math.min(parseInt(req.query.routeLimit, 10) || 1000, 5000);

//     let session = await Session.findById(sessionId);
//     if (!session) {
//       return res.status(404).json({ message: 'Session not found' });
//     }

//     // ✅ Auto-end if stale
//     session = await autoEndSessionIfStale(session);

//     // ✅ Always rebuild route for ACTIVE sessions
//     if (session.status === 'ACTIVE') {
//       const rebuilt = await rebuildSessionRoute(sessionId);
//       if (rebuilt) {
//         session = rebuilt;
//       }
//     }

//     // ✅ Paginate route if requested
//     if (routePage) {
//       const sessionObj = session.toObject();
//       const start = (routePage - 1) * routeLimit;
//       const totalPoints = sessionObj.route.length;
//       sessionObj.route = sessionObj.route.slice(start, start + routeLimit);
//       sessionObj.routePagination = {
//         page: routePage,
//         limit: routeLimit,
//         total: totalPoints,
//         totalPages: Math.ceil(totalPoints / routeLimit),
//       };
//       return res.json(sessionObj);
//     }

//     res.json(session);
//   } catch (err) {
//     console.error('❌ Error fetching session:', err.message);
//     res.status(500).json({ message: 'Error fetching session', error: err.message });
//   }
// });

// module.exports = router;

