// const express = require("express");
// const router = express.Router();
// const Session = require("../models/FSEModel/Session");
// const Location = require("../models/LocationModel/Location");
// const calculateDistance = require("../utils/distance");

// // ✅ GET ALL SESSIONS (FIX THIS ISSUE)
// router.get("/", async (req, res) => {
//   try {
//     console.log("📥 GET /api/session called");

//     const sessions = await Session.find()
//       .sort({ createdAt: -1 });

//     res.status(200).json({
//       success: true,
//       sessions
//     });

//   } catch (err) {
//     console.log("❌ Error fetching sessions:", err.message);
//     res.status(500).json({
//       success: false,
//       message: err.message
//     });
//   }
// });

// // ✅ CHECK TODAY'S SESSION
// router.get("/today/:userId", async (req, res) => {
//   try {
//     const { userId } = req.params;

//     console.log(`🔍 Checking for today's session - userId: ${userId}`);

//     if (!userId) {
//       return res.status(400).json({ message: "userId is required" });
//     }

//     // ✅ Define today's date range
//     const startOfDay = new Date();
//     startOfDay.setHours(0, 0, 0, 0);

//     const endOfDay = new Date();
//     endOfDay.setHours(23, 59, 59, 999);

//     // ✅ Find active session for today
//     const session = await Session.findOne({
//       userId,
//       status: { $in: ["ACTIVE", "AUTO_ENDED"] },
//       startTime: { $gte: startOfDay, $lte: endOfDay }
//     });

//     if (!session) {
//       console.log(`ℹ️ No active session found for today - userId: ${userId}`);
//       return res.status(404).json({ message: "No active session today" });
//     }

//     console.log(`✅ Found existing session - sessionId: ${session._id}`);
//     res.json(session);

//   } catch (err) {
//     console.log('❌ Error in /today/:userId:', err);
//     res.status(500).json({ 
//       message: "Error checking session",
//       error: err.message 
//     });
//   }
// });


// // ✅ START NEW SESSION
// router.post("/start", async (req, res) => {
//   try {
//     const { userId, latitude, longitude } = req.body;

//     console.log(`📨 POST /api/session/start received`);
//     console.log(`   userId: ${userId} (type: ${typeof userId})`);
//     console.log(`   latitude: ${latitude} (type: ${typeof latitude})`);
//     console.log(`   longitude: ${longitude} (type: ${typeof longitude})`);

//     // ✅ VALIDATE USERID
//     if (!userId || userId.toString().trim() === '') {
//       console.log('❌ VALIDATION FAILED: userId is empty or null');
//       return res.status(400).json({ 
//         message: "userId is required",
//         received: { userId }
//       });
//     }

//     // ✅ VALIDATE LATITUDE
//     if (latitude === undefined || latitude === null || latitude === '') {
//       console.log('❌ VALIDATION FAILED: latitude is missing');
//       return res.status(400).json({ 
//         message: "latitude is required",
//         received: { latitude }
//       });
//     }

//     // ✅ VALIDATE LONGITUDE
//     if (longitude === undefined || longitude === null || longitude === '') {
//       console.log('❌ VALIDATION FAILED: longitude is missing');
//       return res.status(400).json({ 
//         message: "longitude is required",
//         received: { longitude }
//       });
//     }

//     // ✅ CONVERT TO PROPER TYPES
//     const lat = parseFloat(latitude);
//     const lng = parseFloat(longitude);

//     if (isNaN(lat) || isNaN(lng)) {
//       console.log('❌ VALIDATION FAILED: latitude or longitude is not a number');
//       return res.status(400).json({ 
//         message: "latitude and longitude must be valid numbers",
//         received: { latitude, longitude }
//       });
//     }

//     console.log('✅ All validations passed');

//     // ✅ Define today's date range
//     const startOfDay = new Date();
//     startOfDay.setHours(0, 0, 0, 0);

//     const endOfDay = new Date();
//     endOfDay.setHours(23, 59, 59, 999);

//     console.log(`🔍 Checking for existing session for userId: ${userId}`);

//     // ✅ Check if session already exists for today
//     const existingSession = await Session.findOne({
//       userId,
//       status: { $in: ["ACTIVE", "AUTO_ENDED"] },
//       startTime: { $gte: startOfDay, $lte: endOfDay }
//     });

//     if (existingSession) {
//       console.log(`⚠️ Session already exists for today - sessionId: ${existingSession._id}`);
//       return res.json(existingSession);
//     }

//     console.log(`📝 Creating new session with startLocation: [${lat}, ${lng}]`);

//     // ✅ Create new session with start location
//     const session = new Session({
//       userId,
//       startLocation: {
//         latitude: lat,
//         longitude: lng
//       },
//       route: [
//         {
//           latitude: lat,
//           longitude: lng,
//           timestamp: new Date()
//         }
//       ],
//       status: "ACTIVE",
//       totalDistanceKm: 0
//     });

//     const savedSession = await session.save();

//     console.log(`✅ Session created successfully:`);
//     console.log(`   sessionId: ${savedSession._id}`);
//     console.log(`   userId: ${savedSession.userId}`);
//     console.log(`   startTime: ${savedSession.startTime}`);
//     console.log(`   status: ${savedSession.status}`);

//     res.status(201).json(savedSession);

//   } catch (err) {
//     console.log('❌ ERROR in /start endpoint:');
//     console.log(`   Message: ${err.message}`);
//     console.log(`   Name: ${err.name}`);
//     console.log(`   Stack: ${err.stack}`);

//     res.status(500).json({ 
//       message: "Error starting session",
//       error: err.message,
//       details: err.name === 'ValidationError' ? err.errors : null
//     });
//   }
// });

// // ✅ END SESSION
// router.post("/end", async (req, res) => {
//   try {
//     const { sessionId } = req.body;

//     console.log(`📨 POST /api/session/end - sessionId: ${sessionId}`);

//     if (!sessionId) {
//       return res.status(400).json({ message: "Session ID required" });
//     }

//     const session = await Session.findByIdAndUpdate(
//       sessionId,
//       {
//         status: "ENDED",
//         endTime: new Date()
//       },
//       { new: true }
//     );

//     if (!session) {
//       console.log(`❌ Session not found: ${sessionId}`);
//       return res.status(404).json({ message: "Session not found" });
//     }

//     console.log(`✅ Session ended successfully - sessionId: ${sessionId}`);
//     res.json(session);

//   } catch (err) {
//     console.log('❌ Error ending session:', err.message);
//     res.status(500).json({ 
//       message: "Error ending session",
//       error: err.message 
//     });
//   }
// });

// // ✅ GET SESSION DETAILS WITH ROUTE
// router.get("/:sessionId", async (req, res) => {
//   try {
//     const { sessionId } = req.params;

//     const session = await Session.findById(sessionId);

//     if (!session) {
//       return res.status(404).json({ message: "Session not found" });
//     }

//     res.json(session);

//   } catch (err) {
//     console.log('❌ Error fetching session:', err.message);
//     res.status(500).json({ 
//       message: "Error fetching session",
//       error: err.message 
//     });
//   }
// });

// module.exports = router;

const express = require("express");
const router = express.Router();
const Session = require("../models/FSEModel/Session");
const Location = require("../models/LocationModel/Location");
const calculateDistance = require("../utils/distance");

// ✅ GET ALL SESSIONS (with pagination and filters)
router.get("/", async (req, res) => {
  try {
    console.log("📥 GET /api/session called");

    const { userId, status, limit = 50 } = req.query;

    // Build filter
    const filter = {};
    if (userId) filter.userId = userId;
    if (status) filter.status = status;

    const sessions = await Session.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      count: sessions.length,
      sessions
    });

  } catch (err) {
    console.log("❌ Error fetching sessions:", err.message);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// ✅ NEW: CLEANUP STALE SESSIONS
router.post("/cleanup", async (req, res) => {
  try {
    const { userId } = req.body;

    console.log(`🧹 POST /api/session/cleanup - userId: ${userId}`);

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    // ✅ Define today's date range
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // ✅ Find all ACTIVE sessions that are NOT from today
    const staleSessions = await Session.find({
      userId,
      status: "ACTIVE",
      startTime: { $lt: startOfDay } // Started before today
    });

    if (staleSessions.length === 0) {
      console.log(`ℹ️ No stale sessions found for userId: ${userId}`);
      return res.json({ 
        success: true, 
        message: "No stale sessions to clean",
        endedCount: 0
      });
    }

    // ✅ Auto-end all stale sessions
    const updateResult = await Session.updateMany(
      {
        userId,
        status: "ACTIVE",
        startTime: { $lt: startOfDay }
      },
      {
        $set: {
          status: "AUTO_ENDED",
          endTime: new Date()
        }
      }
    );

    console.log(`✅ Auto-ended ${updateResult.modifiedCount} stale session(s)`);

    res.json({
      success: true,
      message: `Auto-ended ${updateResult.modifiedCount} stale session(s)`,
      endedCount: updateResult.modifiedCount,
      sessionIds: staleSessions.map(s => s._id)
    });

  } catch (err) {
    console.log('❌ Error in cleanup:', err.message);
    res.status(500).json({ 
      success: false,
      message: "Error cleaning up sessions",
      error: err.message 
    });
  }
});

// ✅ CHECK TODAY'S SESSION
router.get("/today/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    console.log(`🔍 Checking for today's session - userId: ${userId}`);

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    // ✅ Define today's date range
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // ✅ Find active session for today ONLY
    const session = await Session.findOne({
      userId,
      status: { $in: ["ACTIVE"] }, // ✅ REMOVED AUTO_ENDED from here
      startTime: { $gte: startOfDay, $lte: endOfDay }
    });

    if (!session) {
      console.log(`ℹ️ No active session found for today - userId: ${userId}`);
      return res.status(404).json({ message: "No active session today" });
    }

    console.log(`✅ Found existing session - sessionId: ${session._id}`);
    res.json(session);

  } catch (err) {
    console.log('❌ Error in /today/:userId:', err);
    res.status(500).json({ 
      message: "Error checking session",
      error: err.message 
    });
  }
});

// ✅ START NEW SESSION
router.post("/start", async (req, res) => {
  try {
    const { userId, latitude, longitude } = req.body;

    console.log(`📨 POST /api/session/start received`);
    console.log(`   userId: ${userId} (type: ${typeof userId})`);
    console.log(`   latitude: ${latitude} (type: ${typeof latitude})`);
    console.log(`   longitude: ${longitude} (type: ${typeof longitude})`);

    // ✅ VALIDATE USERID
    if (!userId || userId.toString().trim() === '') {
      console.log('❌ VALIDATION FAILED: userId is empty or null');
      return res.status(400).json({ 
        message: "userId is required",
        received: { userId }
      });
    }

    // ✅ VALIDATE LATITUDE
    if (latitude === undefined || latitude === null || latitude === '') {
      console.log('❌ VALIDATION FAILED: latitude is missing');
      return res.status(400).json({ 
        message: "latitude is required",
        received: { latitude }
      });
    }

    // ✅ VALIDATE LONGITUDE
    if (longitude === undefined || longitude === null || longitude === '') {
      console.log('❌ VALIDATION FAILED: longitude is missing');
      return res.status(400).json({ 
        message: "longitude is required",
        received: { longitude }
      });
    }

    // ✅ CONVERT TO PROPER TYPES
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      console.log('❌ VALIDATION FAILED: latitude or longitude is not a number');
      return res.status(400).json({ 
        message: "latitude and longitude must be valid numbers",
        received: { latitude, longitude }
      });
    }

    console.log('✅ All validations passed');

    // ✅ Define today's date range
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    console.log(`🔍 Checking for existing session for userId: ${userId}`);

    // ✅ Check if ACTIVE session already exists for today
    const existingSession = await Session.findOne({
      userId,
      status: "ACTIVE", // ✅ Only check ACTIVE, not AUTO_ENDED
      startTime: { $gte: startOfDay, $lte: endOfDay }
    });

    if (existingSession) {
      console.log(`⚠️ Session already exists for today - sessionId: ${existingSession._id}`);
      return res.json(existingSession);
    }

    console.log(`📝 Creating new session with startLocation: [${lat}, ${lng}]`);

    // ✅ Create new session with start location
    const session = new Session({
      userId,
      startLocation: {
        latitude: lat,
        longitude: lng
      },
      route: [
        {
          latitude: lat,
          longitude: lng,
          timestamp: new Date()
        }
      ],
      status: "ACTIVE",
      totalDistanceKm: 0
    });

    const savedSession = await session.save();

    console.log(`✅ Session created successfully:`);
    console.log(`   sessionId: ${savedSession._id}`);
    console.log(`   userId: ${savedSession.userId}`);
    console.log(`   startTime: ${savedSession.startTime}`);
    console.log(`   status: ${savedSession.status}`);

    res.status(201).json(savedSession);

  } catch (err) {
    console.log('❌ ERROR in /start endpoint:');
    console.log(`   Message: ${err.message}`);
    console.log(`   Name: ${err.name}`);
    console.log(`   Stack: ${err.stack}`);

    res.status(500).json({ 
      message: "Error starting session",
      error: err.message,
      details: err.name === 'ValidationError' ? err.errors : null
    });
  }
});

// ✅ END SESSION
router.post("/end", async (req, res) => {
  try {
    const { sessionId } = req.body;

    console.log(`📨 POST /api/session/end - sessionId: ${sessionId}`);

    if (!sessionId) {
      return res.status(400).json({ message: "Session ID required" });
    }

    const session = await Session.findByIdAndUpdate(
      sessionId,
      {
        status: "ENDED",
        endTime: new Date()
      },
      { new: true }
    );

    if (!session) {
      console.log(`❌ Session not found: ${sessionId}`);
      return res.status(404).json({ message: "Session not found" });
    }

    console.log(`✅ Session ended successfully - sessionId: ${sessionId}`);
    res.json(session);

  } catch (err) {
    console.log('❌ Error ending session:', err.message);
    res.status(500).json({ 
      message: "Error ending session",
      error: err.message 
    });
  }
});

// ✅ GET SESSION DETAILS WITH ROUTE
router.get("/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await Session.findById(sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    res.json(session);

  } catch (err) {
    console.log('❌ Error fetching session:', err.message);
    res.status(500).json({ 
      message: "Error fetching session",
      error: err.message 
    });
  }
});

// ✅ NEW: GET USER'S SESSION HISTORY
router.get("/user/:userId/history", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 30, status } = req.query;

    const filter = { userId };
    if (status) filter.status = status;

    const sessions = await Session.find(filter)
      .sort({ startTime: -1 })
      .limit(parseInt(limit))
      .select('startTime endTime status totalDistanceKm startLocation');

    res.json({
      success: true,
      count: sessions.length,
      sessions
    });

  } catch (err) {
    console.log('❌ Error fetching history:', err.message);
    res.status(500).json({ 
      message: "Error fetching session history",
      error: err.message 
    });
  }
});

module.exports = router;