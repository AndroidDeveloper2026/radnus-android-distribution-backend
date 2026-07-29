const express = require('express');
const router = express.Router();
const Session = require('../models/FSEModel/Session');
const Location = require('../models/LocationModel/Location');
const calculateDistance = require('../utils/distance');

// ✅ NOTE: Add your auth middleware here, e.g.:
// const authMiddleware = require('../middleware/auth');
// router.use(authMiddleware);

const STALE_SESSION_HOURS = 24;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // run cleanup every hour

// ─── ORPHANED / STALE SESSION CLEANUP ────────────────────────────────────────
// Ends any ACTIVE session that has been running longer than STALE_SESSION_HOURS,
// and marks it AUTO_ENDED so it doesn't block the user from starting a new day.
async function cleanupStaleSessions() {
  try {
    const cutoff = new Date(Date.now() - STALE_SESSION_HOURS * 60 * 60 * 1000);

    const staleSessions = await Session.find({
      status: 'ACTIVE',
      startTime: { $lte: cutoff },
    });

    if (staleSessions.length === 0) return;

    for (const session of staleSessions) {
      // ✅ Best-effort distance recalculation before auto-ending
      let totalDistanceKm = session.totalDistanceKm || 0;
      try {
        const locations = await Location.find({ sessionId: session._id })
          .sort({ timestamp: 1 })
          .lean();

        let recalculated = 0;
        for (let i = 1; i < locations.length; i++) {
          recalculated += calculateDistance(
            locations[i - 1].latitude,
            locations[i - 1].longitude,
            locations[i].latitude,
            locations[i].longitude,
          );
        }
        if (locations.length > 1) {
          totalDistanceKm = recalculated;
        }
      } catch (distErr) {
        console.log('⚠️ Could not recalculate distance during cleanup:', distErr.message);
      }

      session.status = 'AUTO_ENDED';
      session.endTime = session.endTime || new Date();
      session.totalDistanceKm = parseFloat(totalDistanceKm.toFixed(3));
      await session.save();

      console.log(`🧹 Auto-ended stale session ${session._id} (older than ${STALE_SESSION_HOURS}h)`);
    }
  } catch (err) {
    console.log('❌ Error during stale session cleanup:', err.message);
  }
}

// ✅ Run cleanup once on module load, then on a recurring interval.
//    This keeps the fix self-contained without requiring a separate cron setup.
cleanupStaleSessions();
setInterval(cleanupStaleSessions, CLEANUP_INTERVAL_MS);

// ─── GET ALL SESSIONS (paginated) ────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    console.log('📥 GET /api/session called');

    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const skip = (page - 1) * limit;

    const { userId, status } = req.query;
    const filter = {};
    if (userId) filter.userId = userId;
    if (status) filter.status = status;

    const [sessions, total] = await Promise.all([
      Session.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        // ✅ Trim heavy route arrays from the list view; full route is fetched via /:sessionId
        .select('-route'),
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

// ─── CHECK TODAY'S SESSION ───────────────────────────────────────────────────
// ✅ Must come before /:sessionId to avoid "today" being passed to findById
router.get('/today/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

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

    res.json(session);
  } catch (err) {
    console.log('❌ Error in /today/:userId:', err);
    res.status(500).json({ message: 'Error checking session', error: err.message });
  }
});

// ─── ORPHANED SESSION CHECK (for app-start recovery) ─────────────────────────
router.get('/orphaned/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const cutoff = new Date(Date.now() - STALE_SESSION_HOURS * 60 * 60 * 1000);

    const orphaned = await Session.findOne({
      userId,
      status: 'ACTIVE',
      startTime: { $lte: cutoff },
    });

    if (!orphaned) {
      return res.status(404).json({ message: 'No orphaned session found' });
    }

    res.json(orphaned);
  } catch (err) {
    console.log('❌ Error checking orphaned session:', err.message);
    res.status(500).json({ message: 'Error checking orphaned session', error: err.message });
  }
});

// ─── START SESSION ───────────────────────────────────────────────────────────
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
      return res.status(400).json({
        message: 'latitude and longitude must be valid numbers',
      });
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const existingSession = await Session.findOne({
      userId,
      status: { $in: ['ACTIVE', 'AUTO_ENDED'] },
      startTime: { $gte: startOfDay, $lte: endOfDay },
    });

    if (existingSession) {
      // ✅ A session for today already exists — its startLocation was LOCKED
      //    the moment it was created and must never be touched here again.
      console.log(`⚠️ Session already exists for today - sessionId: ${existingSession._id}`);
      return res.json(existingSession);
    }

    // ✅ LOCK the start location permanently at creation time. startLocation
    //    (and route[0], which mirrors it) is written exactly once here and no
    //    other route in this file ever modifies it afterward.
    const lockedStartLocation = { latitude: lat, longitude: lng };

    const session = new Session({
      userId,
      startLocation: lockedStartLocation,
      route: [{ latitude: lat, longitude: lng, timestamp: new Date() }],
      status: 'ACTIVE',
      totalDistanceKm: 0,
    });

    const savedSession = await session.save();
    console.log(`✅ Session created - sessionId: ${savedSession._id}, startLocation LOCKED at (${lat}, ${lng})`);

    // ✅ Return the locked location explicitly so the app can pin it down
    //    without waiting on any further GPS reads.
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

// ─── END SESSION ─────────────────────────────────────────────────────────────
router.post('/end', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ message: 'Session ID required' });
    }

    // ✅ FIX: calculate totalDistanceKm from Location records before ending
    let totalDistanceKm = 0;
    try {
      const locations = await Location.find({ sessionId })
        .sort({ timestamp: 1 })
        .lean();

      for (let i = 1; i < locations.length; i++) {
        const prev = locations[i - 1];
        const curr = locations[i];
        totalDistanceKm += calculateDistance(
          prev.latitude,
          prev.longitude,
          curr.latitude,
          curr.longitude,
        );
      }

      console.log(`📏 Total distance for session ${sessionId}: ${totalDistanceKm.toFixed(3)} km`);
    } catch (distErr) {
      // ✅ Don't block session end if distance calc fails — just log it
      console.log('⚠️ Could not calculate distance:', distErr.message);
    }

    const session = await Session.findByIdAndUpdate(
      sessionId,
      {
        status: 'ENDED',
        endTime: new Date(),
        totalDistanceKm: parseFloat(totalDistanceKm.toFixed(3)),
      },
      { new: true },
    );

    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    console.log(`✅ Session ended - sessionId: ${sessionId}`);
    res.json(session);
  } catch (err) {
    console.log('❌ Error ending session:', err.message);
    res.status(500).json({ message: 'Error ending session', error: err.message });
  }
});

// ─── MANUAL CLEANUP TRIGGER (for admin / ops use) ────────────────────────────
router.post('/cleanup', async (req, res) => {
  try {
    await cleanupStaleSessions();

    // ✅ Also remove sessions left in an incomplete state with no route data at all
    const cutoff = new Date(Date.now() - STALE_SESSION_HOURS * 60 * 60 * 1000);
    const incompleteResult = await Session.updateMany(
      {
        status: 'ACTIVE',
        startTime: { $lte: cutoff },
        $or: [{ route: { $size: 0 } }, { route: { $exists: false } }],
      },
      { status: 'ENDED', endTime: new Date() },
    );

    res.json({
      success: true,
      message: 'Cleanup completed',
      incompleteSessionsClosed: incompleteResult.modifiedCount || 0,
    });
  } catch (err) {
    console.log('❌ Error running manual cleanup:', err.message);
    res.status(500).json({ message: 'Error running cleanup', error: err.message });
  }
});

// ─── GET SESSION BY ID ───────────────────────────────────────────────────────
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    // ✅ Optional route pagination via ?routePage & ?routeLimit for large sessions
    const routePage = parseInt(req.query.routePage, 10) || null;
    const routeLimit = Math.min(parseInt(req.query.routeLimit, 10) || 1000, 5000);

    const session = await Session.findById(sessionId);

    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

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
    console.log('❌ Error fetching session:', err.message);
    res.status(500).json({ message: 'Error fetching session', error: err.message });
  }
});

module.exports = router;

//---------- fse old -------------------
// const express = require('express');
// const router = express.Router();
// const Session = require('../models/FSEModel/Session');
// const Location = require('../models/LocationModel/Location');
// const calculateDistance = require('../utils/distance');

// // ✅ NOTE: Add your auth middleware here, e.g.:
// // const authMiddleware = require('../middleware/auth');
// // router.use(authMiddleware);

// // ─── GET ALL SESSIONS ────────────────────────────────────────────────────────
// router.get('/', async (req, res) => {
//   try {
//     console.log('📥 GET /api/session called');

//     const sessions = await Session.find().sort({ createdAt: -1 });

//     res.status(200).json({
//       success: true,
//       sessions,
//     });
//   } catch (err) {
//     console.log('❌ Error fetching sessions:', err.message);
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

// // ─── CHECK TODAY'S SESSION ───────────────────────────────────────────────────
// // ✅ Must come before /:sessionId to avoid "today" being passed to findById
// router.get('/today/:userId', async (req, res) => {
//   try {
//     const { userId } = req.params;

//     if (!userId) {
//       return res.status(400).json({ message: 'userId is required' });
//     }

//     const startOfDay = new Date();
//     startOfDay.setHours(0, 0, 0, 0);

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

//     const startOfDay = new Date();
//     startOfDay.setHours(0, 0, 0, 0);

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

//     const session = new Session({
//       userId,
//       startLocation: { latitude: lat, longitude: lng },
//       route: [{ latitude: lat, longitude: lng, timestamp: new Date() }],
//       status: 'ACTIVE',
//       totalDistanceKm: 0,
//     });

//     const savedSession = await session.save();
//     console.log(`✅ Session created - sessionId: ${savedSession._id}`);
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
//     const { sessionId } = req.body;

//     if (!sessionId) {
//       return res.status(400).json({ message: 'Session ID required' });
//     }

//     // ✅ FIX: calculate totalDistanceKm from Location records before ending
//     let totalDistanceKm = 0;
//     try {
//       const locations = await Location.find({ sessionId })
//         .sort({ timestamp: 1 })
//         .lean();

//       for (let i = 1; i < locations.length; i++) {
//         const prev = locations[i - 1];
//         const curr = locations[i];
//         totalDistanceKm += calculateDistance(
//           prev.latitude,
//           prev.longitude,
//           curr.latitude,
//           curr.longitude,
//         );
//       }

//       console.log(`📏 Total distance for session ${sessionId}: ${totalDistanceKm.toFixed(3)} km`);
//     } catch (distErr) {
//       // ✅ Don't block session end if distance calc fails — just log it
//       console.log('⚠️ Could not calculate distance:', distErr.message);
//     }

//     const session = await Session.findByIdAndUpdate(
//       sessionId,
//       {
//         status: 'ENDED',
//         endTime: new Date(),
//         totalDistanceKm: parseFloat(totalDistanceKm.toFixed(3)),
//       },
//       { new: true },
//     );

//     if (!session) {
//       return res.status(404).json({ message: 'Session not found' });
//     }

//     console.log(`✅ Session ended - sessionId: ${sessionId}`);
//     res.json(session);
//   } catch (err) {
//     console.log('❌ Error ending session:', err.message);
//     res.status(500).json({ message: 'Error ending session', error: err.message });
//   }
// });

// // ─── GET SESSION BY ID ───────────────────────────────────────────────────────
// router.get('/:sessionId', async (req, res) => {
//   try {
//     const { sessionId } = req.params;

//     const session = await Session.findById(sessionId);

//     if (!session) {
//       return res.status(404).json({ message: 'Session not found' });
//     }

//     res.json(session);
//   } catch (err) {
//     console.log('❌ Error fetching session:', err.message);
//     res.status(500).json({ message: 'Error fetching session', error: err.message });
//   }
// });

// module.exports = router;
