// sessionRoutes.js - COMPLETE FIXED VERSION

const express = require('express');
const router = express.Router();
const Session = require('../models/FSEModel/Session');
const Location = require('../models/LocationModel/Location');
const calculateDistance = require('../utils/distance');
const { runExclusive } = require('../utils/sessionLock');

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function getStartOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isFromPreviousDay(date) {
  return new Date(date) < getStartOfToday();
}

// ─── Route rebuild helper ──────────────────────────────────────────────
async function rebuildSessionRoute(sessionId) {
  try {
    const locations = await Location.find({ sessionId })
      .sort({ timestamp: 1 })
      .lean();

    if (locations.length === 0) {
      return null;
    }

    let totalDistance = 0;
    for (let i = 1; i < locations.length; i++) {
      const prev = locations[i - 1];
      const curr = locations[i];
      totalDistance += calculateDistance(
        prev.latitude, prev.longitude,
        curr.latitude, curr.longitude
      );
    }

    const route = locations.map(l => ({
      latitude: l.latitude,
      longitude: l.longitude,
      timestamp: l.timestamp,
    }));

    const updatedSession = await Session.findByIdAndUpdate(
      sessionId,
      {
        route: route,
        totalDistanceKm: parseFloat(totalDistance.toFixed(4)),
        pointCount: locations.length,
      },
      { new: true }
    );

    console.log(`🔄 Route rebuilt: ${locations.length} points, ${totalDistance.toFixed(4)}km`);
    return updatedSession;
  } catch (err) {
    console.error(`❌ Failed to rebuild route:`, err.message);
    return null;
  }
}

// ─── Auto-end stale sessions ────────────────────────────────────────────
async function autoEndSessionIfStale(session) {
  if (!session || session.status !== 'ACTIVE') return session;
  if (!isFromPreviousDay(session.startTime)) return session;

  return runExclusive(session._id, async () => {
    const fresh = await Session.findById(session._id);
    if (!fresh || fresh.status !== 'ACTIVE') return fresh || session;

    // ✅ Rebuild route before ending
    const rebuilt = await rebuildSessionRoute(session._id);
    const finalSession = rebuilt || fresh;

    finalSession.status = 'AUTO_ENDED';
    finalSession.endTime = finalSession.endTime || new Date();
    await finalSession.save();

    console.log(`🧹 Auto-ended session ${finalSession._id}`);
    return finalSession;
  });
}

async function cleanupStaleSessions() {
  try {
    const staleSessions = await Session.find({
      status: 'ACTIVE',
      startTime: { $lt: getStartOfToday() }
    });

    for (const session of staleSessions) {
      await autoEndSessionIfStale(session);
    }
  } catch (err) {
    console.log('❌ Error during stale session cleanup:', err.message);
  }
}

cleanupStaleSessions();
setInterval(cleanupStaleSessions, CLEANUP_INTERVAL_MS);

// ─── GET ALL SESSIONS ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const skip = (page - 1) * limit;
    const { userId, status } = req.query;
    const filter = {};
    if (userId) filter.userId = userId;
    if (status) filter.status = status;

    const [sessions, total] = await Promise.all([
      Session.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).select('-route'),
      Session.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      sessions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.log('❌ Error fetching sessions:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── CHECK TODAY'S SESSION ──────────────────────────────────────────────
router.get('/today/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const startOfDay = getStartOfToday();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const session = await Session.findOne({
      userId,
      status: { $in: ['ACTIVE', 'AUTO_ENDED'] },
      startTime: { $gte: startOfDay, $lte: endOfDay },
    });

    if (!session) {
      return res.status(404).json({ message: 'No active session today' });
    }

    // ✅ Rebuild route before returning
    if (session.status === 'ACTIVE') {
      const rebuilt = await rebuildSessionRoute(session._id);
      if (rebuilt) {
        return res.json(rebuilt);
      }
    }

    res.json(session);
  } catch (err) {
    console.log('❌ Error in /today/:userId:', err);
    res.status(500).json({ message: 'Error checking session', error: err.message });
  }
});

// ─── ORPHANED SESSION CHECK ─────────────────────────────────────────────
router.get('/orphaned/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const orphaned = await Session.findOne({
      userId,
      status: 'ACTIVE',
      startTime: { $lt: getStartOfToday() }
    });

    if (!orphaned) {
      return res.status(404).json({ message: 'No orphaned session found' });
    }

    // ✅ Rebuild route before returning
    const rebuilt = await rebuildSessionRoute(orphaned._id);
    res.json(rebuilt || orphaned);
  } catch (err) {
    console.log('❌ Error checking orphaned session:', err.message);
    res.status(500).json({ message: 'Error checking orphaned session', error: err.message });
  }
});

// ─── START SESSION ──────────────────────────────────────────────────────
router.post('/start', async (req, res) => {
  try {
    const { userId, latitude, longitude } = req.body;

    if (!userId || userId.toString().trim() === '') {
      return res.status(400).json({ message: 'userId is required' });
    }
    if (latitude === undefined || latitude === null || latitude === '') {
      return res.status(400).json({ message: 'latitude is required' });
    }
    if (longitude === undefined || longitude === null || longitude === '') {
      return res.status(400).json({ message: 'longitude is required' });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ message: 'latitude and longitude must be valid numbers' });
    }

    const startOfDay = getStartOfToday();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const existingSession = await Session.findOne({
      userId,
      status: { $in: ['ACTIVE', 'AUTO_ENDED'] },
      startTime: { $gte: startOfDay, $lte: endOfDay },
    });

    if (existingSession) {
      console.log(`⚠️ Session already exists for today - sessionId: ${existingSession._id}`);
      return res.json(existingSession);
    }

    const lockedStartLocation = { latitude: lat, longitude: lng };

    const session = new Session({
      userId,
      startLocation: lockedStartLocation,
      route: [{ latitude: lat, longitude: lng, timestamp: new Date() }],
      status: 'ACTIVE',
      totalDistanceKm: 0,
      pointCount: 1,
    });

    const savedSession = await session.save();
    console.log(`✅ Session created - sessionId: ${savedSession._id}`);

    // ✅ Save start point to Location collection
    try {
      await Location.create({
        userId,
        sessionId: savedSession._id,
        latitude: lat,
        longitude: lng,
        timestamp: savedSession.startTime,
      });
      console.log(`✅ Start point saved to Location for session ${savedSession._id}`);
    } catch (locErr) {
      console.error('⚠️ Could not save start point to Location:', locErr.message);
    }

    res.status(201).json(savedSession);
  } catch (err) {
    console.log('❌ ERROR in /start:', err.message);
    res.status(500).json({
      message: 'Error starting session',
      error: err.message,
      details: err.name === 'ValidationError' ? err.errors : null,
    });
  }
});

// ─── END SESSION ────────────────────────────────────────────────────────
router.post('/end', async (req, res) => {
  try {
    const { sessionId, finalLocation } = req.body;
    if (!sessionId) {
      return res.status(400).json({ message: 'Session ID required' });
    }

    console.log(`📤 Ending session: ${sessionId}`);

    const session = await runExclusive(sessionId, async () => {
      // ✅ Save final location if provided
      if (finalLocation && finalLocation.latitude && finalLocation.longitude) {
        try {
          const existing = await Session.findById(sessionId).select('userId').lean();
          if (existing) {
            await Location.create({
              userId: existing.userId,
              sessionId,
              latitude: finalLocation.latitude,
              longitude: finalLocation.longitude,
              timestamp: new Date(),
            });
            console.log('✅ Final location saved');
          }
        } catch (locErr) {
          console.error('⚠️ Could not save final location:', locErr.message);
        }
      }

      // ✅ Rebuild route from Location collection
      const rebuilt = await rebuildSessionRoute(sessionId);
      if (rebuilt) {
        // Update status to ENDED
        const updated = await Session.findByIdAndUpdate(
          sessionId,
          {
            status: 'ENDED',
            endTime: new Date(),
          },
          { new: true }
        );
        return updated;
      }

      // Fallback if rebuild fails
      const updated = await Session.findByIdAndUpdate(
        sessionId,
        {
          status: 'ENDED',
          endTime: new Date(),
        },
        { new: true }
      );
      return updated;
    });

    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    console.log(`✅ Session ended - ${sessionId}, Distance: ${session.totalDistanceKm}km, Points: ${session.pointCount}`);
    res.json(session);
  } catch (err) {
    console.error('❌ Error ending session:', err.message);
    res.status(500).json({ message: 'Error ending session', error: err.message });
  }
});

// ─── GET SESSION BY ID ──────────────────────────────────────────────────
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const routePage = parseInt(req.query.routePage, 10) || null;
    const routeLimit = Math.min(parseInt(req.query.routeLimit, 10) || 1000, 5000);

    let session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    // ✅ Auto-end if stale
    session = await autoEndSessionIfStale(session);

    // ✅ Always rebuild route for ACTIVE sessions
    if (session.status === 'ACTIVE') {
      const rebuilt = await rebuildSessionRoute(sessionId);
      if (rebuilt) {
        session = rebuilt;
      }
    }

    // ✅ Paginate route if requested
    if (routePage) {
      const sessionObj = session.toObject();
      const start = (routePage - 1) * routeLimit;
      const totalPoints = sessionObj.route.length;
      sessionObj.route = sessionObj.route.slice(start, start + routeLimit);
      sessionObj.routePagination = {
        page: routePage,
        limit: routeLimit,
        total: totalPoints,
        totalPages: Math.ceil(totalPoints / routeLimit),
      };
      return res.json(sessionObj);
    }

    res.json(session);
  } catch (err) {
    console.error('❌ Error fetching session:', err.message);
    res.status(500).json({ message: 'Error fetching session', error: err.message });
  }
});

module.exports = router;

//------------ 08.08.2026 --------------------
// // sessionRoutes.js - COMPLETE PRODUCTION VERSION

// const express = require('express');
// const router = express.Router();
// const Session = require('../models/FSEModel/Session');
// const Location = require('../models/LocationModel/Location');
// const calculateDistance = require('../utils/distance');
// const { runExclusive } = require('../utils/sessionLock');

// // ✅ NOTE: Add your auth middleware here, e.g.:
// // const authMiddleware = require('../middleware/auth');
// // router.use(authMiddleware);

// const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // run cleanup every hour

// // ─── DAY BOUNDARY HELPERS ─────────────────────────────────────────────────
// function getStartOfToday() {
//   const d = new Date();
//   d.setHours(0, 0, 0, 0);
//   return d;
// }

// function isFromPreviousDay(date) {
//   return new Date(date) < getStartOfToday();
// }

// // ─── AUTO-END A SINGLE STALE SESSION ─────────────────────────────────────
// // A session is "stale" once its startTime falls before today's midnight —
// // i.e. it belongs to a previous calendar day.
// async function autoEndSessionIfStale(session) {
//   if (!session || session.status !== 'ACTIVE') return session;
//   if (!isFromPreviousDay(session.startTime)) return session;

//   return runExclusive(session._id, async () => {
//     // Re-fetch inside the lock in case another request already ended it
//     // while we were waiting our turn in the queue.
//     const fresh = await Session.findById(session._id);
//     if (!fresh || fresh.status !== 'ACTIVE') return fresh || session;

//     let totalDistanceKm = fresh.totalDistanceKm || 0;
//     let pointCount = fresh.pointCount || fresh.route.length;
//     try {
//       const locations = await Location.find({ sessionId: fresh._id })
//         .sort({ timestamp: 1 })
//         .lean();

//       let recalculated = 0;
//       for (let i = 1; i < locations.length; i++) {
//         recalculated += calculateDistance(
//           locations[i - 1].latitude,
//           locations[i - 1].longitude,
//           locations[i].latitude,
//           locations[i].longitude,
//         );
//       }
//       if (locations.length > 1) {
//         totalDistanceKm = recalculated;
//       }
//       if (locations.length > 0) {
//         pointCount = locations.length;
//       }
//     } catch (distErr) {
//       console.log('⚠️ Could not recalculate distance during auto-end:', distErr.message);
//     }

//     fresh.status = 'AUTO_ENDED';
//     fresh.endTime = fresh.endTime || new Date();
//     fresh.totalDistanceKm = parseFloat(totalDistanceKm.toFixed(4));
//     fresh.pointCount = pointCount;
//     await fresh.save();

//     console.log(`🧹 Auto-ended session ${fresh._id} — belongs to a previous day`);
//     return fresh;
//   });
// }

// // ─── HOURLY SWEEP (safety net) ────────────────────────────────────────────
// async function cleanupStaleSessions() {
//   try {
//     const staleSessions = await Session.find({
//       status: 'ACTIVE',
//       startTime: { $lt: getStartOfToday() },
//     });

//     for (const session of staleSessions) {
//       await autoEndSessionIfStale(session);
//     }
//   } catch (err) {
//     console.log('❌ Error during stale session cleanup:', err.message);
//   }
// }

// // Run cleanup on startup
// cleanupStaleSessions();
// setInterval(cleanupStaleSessions, CLEANUP_INTERVAL_MS);

// // ─── GET ALL SESSIONS (paginated) ────────────────────────────────────────────
// router.get('/', async (req, res) => {
//   try {
//     console.log('📥 GET /api/session called');

//     const page = parseInt(req.query.page, 10) || 1;
//     const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
//     const skip = (page - 1) * limit;

//     const { userId, status } = req.query;
//     const filter = {};
//     if (userId) filter.userId = userId;
//     if (status) filter.status = status;

//     const [sessions, total] = await Promise.all([
//       Session.find(filter)
//         .sort({ createdAt: -1 })
//         .skip(skip)
//         .limit(limit)
//         .select('-route'),
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

// // ─── CHECK TODAY'S SESSION ───────────────────────────────────────────────────
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

//     res.json(session);
//   } catch (err) {
//     console.log('❌ Error in /today/:userId:', err);
//     res.status(500).json({ message: 'Error checking session', error: err.message });
//   }
// });

// // ─── ORPHANED SESSION CHECK (for app-start recovery) ─────────────────────────
// router.get('/orphaned/:userId', async (req, res) => {
//   try {
//     const { userId } = req.params;

//     if (!userId) {
//       return res.status(400).json({ message: 'userId is required' });
//     }

//     // Same day-boundary rule as everywhere else
//     const orphaned = await Session.findOne({
//       userId,
//       status: 'ACTIVE',
//       startTime: { $lt: getStartOfToday() },
//     });

//     if (!orphaned) {
//       return res.status(404).json({ message: 'No orphaned session found' });
//     }

//     res.json(orphaned);
//   } catch (err) {
//     console.log('❌ Error checking orphaned session:', err.message);
//     res.status(500).json({ message: 'Error checking orphaned session', error: err.message });
//   }
// });

// // ─── START SESSION ───────────────────────────────────────────────────────────
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
//       return res.status(400).json({
//         message: 'latitude and longitude must be valid numbers',
//       });
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
//     console.log(`✅ Session created - sessionId: ${savedSession._id}, startLocation LOCKED at (${lat}, ${lng})`);

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

// // ─── END SESSION ─────────────────────────────────────────────────────────────
// router.post('/end', async (req, res) => {
//   try {
//     const { sessionId, finalLocation } = req.body;

//     if (!sessionId) {
//       return res.status(400).json({ message: 'Session ID required' });
//     }

//     console.log(`📤 Ending session: ${sessionId}`);

//     const session = await runExclusive(sessionId, async () => {
//       // ✅ If finalLocation provided, add it as the last point BEFORE
//       //    recalculating, so it's included in the distance/point totals.
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
//             await Session.findByIdAndUpdate(sessionId, {
//               $push: {
//                 route: {
//                   latitude: finalLocation.latitude,
//                   longitude: finalLocation.longitude,
//                   timestamp: new Date(),
//                 },
//               },
//             });
//             console.log('✅ Final location saved');
//           }
//         } catch (locErr) {
//           console.error('⚠️ Could not save final location:', locErr.message);
//         }
//       }

//       // ✅ Calculate totalDistanceKm + pointCount from Location records —
//       //    these are the source of truth (each is written independently via
//       //    Location.create and never touched by concurrent writes the way
//       //    the embedded route array historically was).
//       let totalDistanceKm = 0;
//       let pointCount = 0;
//       try {
//         const locations = await Location.find({ sessionId })
//           .sort({ timestamp: 1 })
//           .lean();

//         pointCount = locations.length;
//         console.log(`📍 Found ${locations.length} location records for session ${sessionId}`);

//         for (let i = 1; i < locations.length; i++) {
//           const prev = locations[i - 1];
//           const curr = locations[i];
//           const dist = calculateDistance(
//             prev.latitude,
//             prev.longitude,
//             curr.latitude,
//             curr.longitude,
//           );
//           totalDistanceKm += dist;
//         }

//         console.log(`📏 Total distance recalculated: ${totalDistanceKm.toFixed(4)} km`);
//       } catch (distErr) {
//         console.error('⚠️ Could not calculate distance:', distErr.message);
//       }

//       // ✅ Update session with recalculated distance + point count
//       const updated = await Session.findByIdAndUpdate(
//         sessionId,
//         {
//           status: 'ENDED',
//           endTime: new Date(),
//           totalDistanceKm: parseFloat(totalDistanceKm.toFixed(4)),
//           ...(pointCount > 0 ? { pointCount } : {}),
//         },
//         { new: true },
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

// // ─── MANUAL CLEANUP TRIGGER (for admin / ops use) ────────────────────────────
// router.post('/cleanup', async (req, res) => {
//   try {
//     await cleanupStaleSessions();

//     const incompleteResult = await Session.updateMany(
//       {
//         status: 'ACTIVE',
//         startTime: { $lt: getStartOfToday() },
//         $or: [{ route: { $size: 0 } }, { route: { $exists: false } }],
//       },
//       { status: 'ENDED', endTime: new Date() },
//     );

//     res.json({
//       success: true,
//       message: 'Cleanup completed',
//       incompleteSessionsClosed: incompleteResult.modifiedCount || 0,
//     });
//   } catch (err) {
//     console.log('❌ Error running manual cleanup:', err.message);
//     res.status(500).json({ message: 'Error running cleanup', error: err.message });
//   }
// });

// // ─── RECALCULATE DISTANCE FOR A SESSION ──────────────────────────────────────
// router.post('/recalculate/:sessionId', async (req, res) => {
//   try {
//     const { sessionId } = req.params;

//     const locations = await Location.find({ sessionId })
//       .sort({ timestamp: 1 })
//       .lean();

//     if (locations.length < 2) {
//       return res.json({ 
//         success: true, 
//         message: 'Not enough points to calculate distance',
//         distance: 0,
//         pointCount: locations.length
//       });
//     }

//     let totalDistance = 0;
//     for (let i = 1; i < locations.length; i++) {
//       const prev = locations[i - 1];
//       const curr = locations[i];
//       const dist = calculateDistance(
//         prev.latitude,
//         prev.longitude,
//         curr.latitude,
//         curr.longitude,
//       );
//       totalDistance += dist;
//     }

//     const session = await Session.findByIdAndUpdate(
//       sessionId,
//       { totalDistanceKm: parseFloat(totalDistance.toFixed(4)) },
//       { new: true }
//     );

//     res.json({
//       success: true,
//       pointCount: locations.length,
//       distance: parseFloat(totalDistance.toFixed(4)),
//       session
//     });

//   } catch (err) {
//     console.error('❌ Error recalculating distance:', err);
//     res.status(500).json({ message: "Error recalculating distance" });
//   }
// });

// // ─── GET SESSION BY ID ───────────────────────────────────────────────────────
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

//     // ✅ For active sessions, rebuild route/distance/pointCount straight from
//     //    the Location collection (each point is written independently via
//     //    Location.create and is never subject to the read-modify-write races
//     //    that used to affect the embedded `route` array). This is what the
//     //    map screen and tracking screen render, so this is what guarantees
//     //    the drawn route and the "X GPS points" / distance figures always
//     //    agree with each other and with reality. Wrapped in the same
//     //    per-session lock as /update so it can't race with an in-flight
//     //    location write.
//     if (session.status === 'ACTIVE') {
//       session = await runExclusive(sessionId, async () => {
//         try {
//           const locations = await Location.find({ sessionId })
//             .sort({ timestamp: 1 })
//             .lean();

//           if (locations.length > 0) {
//             let recalculatedDist = 0;
//             for (let i = 1; i < locations.length; i++) {
//               recalculatedDist += calculateDistance(
//                 locations[i - 1].latitude,
//                 locations[i - 1].longitude,
//                 locations[i].latitude,
//                 locations[i].longitude,
//               );
//             }

//             const route = locations.map(l => ({
//               latitude: l.latitude,
//               longitude: l.longitude,
//               timestamp: l.timestamp,
//             }));

//             const updated = await Session.findByIdAndUpdate(
//               sessionId,
//               {
//                 totalDistanceKm: parseFloat(recalculatedDist.toFixed(4)),
//                 pointCount: locations.length,
//                 route,
//               },
//               { new: true },
//             );
//             console.log(`📏 Route/distance synced from Location collection on fetch: ${updated.pointCount} points, ${updated.totalDistanceKm}km`);
//             return updated;
//           }
//         } catch (distErr) {
//           console.error('⚠️ Could not recalculate distance on fetch:', distErr.message);
//         }
//         return session;
//       });
//     }

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
