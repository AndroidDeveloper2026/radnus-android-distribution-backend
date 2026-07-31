const router = require('express').Router();
const Session = require('../models/FSEModel/Session');

router.post('/start', async (req, res) => {
  console.log('📋 SESSION START REQUEST');
  console.log('📋 Body:', req.body);

  try {
    const { userId, latitude, longitude } = req.body;

    if (!userId) {
      console.log('❌ Missing userId');
      return res.status(400).json({ message: 'User ID required' });
    }

    const existing = await Session.findOne({
      userId,
      status: 'ACTIVE'
    });

    if (existing) {
      console.log(`⚠️ Active session exists: ${existing._id}`);
      return res.json(existing);
    }

    const session = new Session({
      userId,
      startLocation: {
        latitude: latitude || 0,
        longitude: longitude || 0
      },
      route: latitude ? [{
        latitude,
        longitude,
        timestamp: new Date()
      }] : [],
      totalDistanceKm: 0,
      startTime: new Date(),
      status: 'ACTIVE'
    });

    await session.save();
    console.log(`✅ Session created: ${session._id}`);
    console.log(`✅ Route initialized with: ${session.route.length} points`);
    console.log(`✅ Start location: ${latitude}, ${longitude}`);

    res.json(session);
  } catch (err) {
    console.error('❌ Session creation error:', err);
    res.status(500).json({ message: 'Failed to start session', error: err.message });
  }
});

router.post('/end', async (req, res) => {
  console.log('📋 SESSION END REQUEST');
  console.log('📋 Body:', req.body);

  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ message: 'Session ID required' });
    }

    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    session.endTime = new Date();
    session.status = 'ENDED';

    await session.save();
    console.log(`✅ Session ended: ${sessionId}`);
    console.log(`✅ Total distance: ${session.totalDistanceKm}km`);
    console.log(`✅ Route points: ${session.route.length}`);

    res.json({ success: true, session });
  } catch (err) {
    console.error('❌ Session end error:', err);
    res.status(500).json({ message: 'Failed to end session', error: err.message });
  }
});

router.get('/today/:userId', async (req, res) => {
  console.log(`📋 CHECKING TODAY'S SESSION for user: ${req.params.userId}`);

  try {
    const { userId } = req.params;
    
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const session = await Session.findOne({
      userId,
      startTime: { $gte: startOfDay },
      status: 'ACTIVE'
    });

    if (session) {
      console.log(`✅ Found active session: ${session._id}`);
      console.log(`✅ Route points: ${session.route.length}`);
      console.log(`✅ Distance: ${session.totalDistanceKm}km`);
      res.json(session);
    } else {
      console.log('❌ No active session found');
      res.status(404).json({ message: 'No active session found' });
    }
  } catch (err) {
    console.error('❌ Error checking today\'s session:', err);
    res.status(500).json({ message: 'Failed to check session', error: err.message });
  }
});

router.get('/:sessionId', async (req, res) => {
  console.log(`📋 FETCHING SESSION: ${req.params.sessionId}`);

  try {
    const { sessionId } = req.params;
    const session = await Session.findById(sessionId);

    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    console.log(`✅ Session found: ${sessionId}`);
    console.log(`✅ Route points: ${session.route.length}`);
    console.log(`✅ Distance: ${session.totalDistanceKm}km`);
    console.log(`✅ Status: ${session.status}`);

    res.json(session);
  } catch (err) {
    console.error('❌ Error fetching session:', err);
    res.status(500).json({ message: 'Failed to fetch session', error: err.message });
  }
});

router.get('/', async (req, res) => {
  console.log('📋 FETCHING ALL SESSIONS');

  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const sessions = await Session.find()
      .sort({ startTime: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Session.countDocuments();

    console.log(`✅ Found ${sessions.length} sessions`);
    console.log(`✅ Total: ${total}`);

    res.json({
      sessions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('❌ Error fetching sessions:', err);
    res.status(500).json({ message: 'Failed to fetch sessions', error: err.message });
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
