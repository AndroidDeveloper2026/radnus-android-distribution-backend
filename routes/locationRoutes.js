// locationRoutes.js - COMPLETE WORKING VERSION

const express = require("express");
const router = express.Router();

// ✅ Import models with correct paths
const Location = require("../models/LocationModel/Location");
const Session = require("../models/FSEModel/Session");
const calculateDistance = require("../utils/distance");

// ── Constants for GPS filtering / dedup ─────────────────────────────────────
const MAX_JUMP_METERS = 500;
const MAX_JUMP_WINDOW_MS = 5000;
const MAX_PLAUSIBLE_SPEED_MPS = 55;
const DUPLICATE_WINDOW_MS = 5000;
const DUPLICATE_DISTANCE_METERS = 2;

const kmToMeters = km => km * 1000;

// ── Determine if a new point should be rejected as a GPS jump/glitch ────────
function isImpossibleJump(prevPoint, latitude, longitude, timestamp) {
  if (!prevPoint) return { reject: false };

  const distanceKm = calculateDistance(
    prevPoint.latitude,
    prevPoint.longitude,
    latitude,
    longitude,
  );
  const distanceMeters = kmToMeters(distanceKm);

  const dtMs = new Date(timestamp) - new Date(prevPoint.timestamp);
  const dtSeconds = dtMs / 1000;

  if (dtSeconds <= 0) {
    return { reject: false, distanceMeters, speedMps: null };
  }

  const speedMps = distanceMeters / dtSeconds;

  if (distanceMeters > MAX_JUMP_METERS && dtMs <= MAX_JUMP_WINDOW_MS) {
    return { reject: true, reason: 'GPS jump exceeds 500m within 5s', distanceMeters, speedMps };
  }

  if (speedMps > MAX_PLAUSIBLE_SPEED_MPS) {
    return { reject: true, reason: 'Implausible speed', distanceMeters, speedMps };
  }

  return { reject: false, distanceMeters, speedMps };
}

// ── Determine if a point is a duplicate ────────────────────────────
function isDuplicatePoint(prevPoint, latitude, longitude, timestamp) {
  if (!prevPoint) return false;

  const dtMs = Math.abs(new Date(timestamp) - new Date(prevPoint.timestamp));
  if (dtMs > DUPLICATE_WINDOW_MS) return false;

  const distanceKm = calculateDistance(
    prevPoint.latitude,
    prevPoint.longitude,
    latitude,
    longitude,
  );
  const distanceMeters = kmToMeters(distanceKm);

  return distanceMeters <= DUPLICATE_DISTANCE_METERS;
}

// ── Core point-processing logic ─────────────────────────
async function processLocationPoint({ userId, sessionId, latitude, longitude, timestamp, accuracy }) {
  // ✅ Validate session exists
  const session = await Session.findById(sessionId);
  if (!session) {
    return { status: 404, body: { message: 'Session not found' } };
  }

  // ✅ Check if session is active
  if (session.status !== 'ACTIVE') {
    return {
      status: 400,
      body: {
        success: false,
        message: `Session is not active (status: ${session.status})`
      }
    };
  }

  // ✅ Get last route point
  const lastRoutePoint = session.route.length > 0
    ? session.route[session.route.length - 1]
    : session.startLocation
      ? { 
          latitude: session.startLocation.latitude, 
          longitude: session.startLocation.longitude, 
          timestamp: session.startTime 
        }
      : null;

  // ✅ Deduplication check
  if (isDuplicatePoint(lastRoutePoint, latitude, longitude, timestamp)) {
    return {
      status: 200,
      body: {
        success: true,
        skipped: true,
        reason: 'duplicate',
        totalDistance: session.totalDistanceKm,
      },
    };
  }

  // ✅ GPS jump / impossible-movement filter
  const jumpCheck = isImpossibleJump(lastRoutePoint, latitude, longitude, timestamp);
  if (jumpCheck.reject) {
    console.log(`⚠️ Rejected GPS point for session ${sessionId}: ${jumpCheck.reason}`);
    return {
      status: 200,
      body: {
        success: true,
        skipped: true,
        reason: jumpCheck.reason,
        totalDistance: session.totalDistanceKm,
      },
    };
  }

  // ✅ Save location to Location collection
  const location = await Location.create({
    userId,
    sessionId,
    latitude,
    longitude,
    timestamp: timestamp || new Date(),
    accuracy: accuracy || null
  });

  // ✅ Calculate distance from previous location
  let distanceIncrement = 0;
  if (lastRoutePoint) {
    distanceIncrement = calculateDistance(
      lastRoutePoint.latitude,
      lastRoutePoint.longitude,
      latitude,
      longitude,
    );

    if (distanceIncrement > 0.001) { // ~1 meter minimum
      session.totalDistanceKm += distanceIncrement;
    }
  }

  // ✅ Add to route
  session.route.push({
    latitude,
    longitude,
    timestamp: timestamp || new Date(),
  });

  // ✅ Trim route if it gets too large (max 10,000 points)
  if (session.route.length > 10000) {
    session.route = session.route.slice(-5000);
    console.log(`✂️ Route trimmed to 5000 points`);
  }

  await session.save();

  return {
    status: 200,
    body: {
      success: true,
      distance: distanceIncrement,
      totalDistance: session.totalDistanceKm,
      location,
    },
  };
}

// ✅ UPDATE LOCATION
router.post("/update", async (req, res) => {
  try {
    console.log('📥 POST /api/location/update - Request received');
    
    const { userId, sessionId, latitude, longitude, timestamp, accuracy } = req.body;

    // ✅ Validate required fields
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }
    if (!sessionId) {
      return res.status(400).json({ message: "sessionId is required" });
    }
    if (latitude === undefined || latitude === null) {
      return res.status(400).json({ message: "latitude is required" });
    }
    if (longitude === undefined || longitude === null) {
      return res.status(400).json({ message: "longitude is required" });
    }

    // ✅ Parse and validate coordinates
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ message: "Invalid latitude or longitude" });
    }

    if (lat < -90 || lat > 90) {
      return res.status(400).json({ message: "Invalid latitude: must be between -90 and 90" });
    }

    if (lng < -180 || lng > 180) {
      return res.status(400).json({ message: "Invalid longitude: must be between -180 and 180" });
    }

    const result = await processLocationPoint({
      userId,
      sessionId,
      latitude: lat,
      longitude: lng,
      timestamp: timestamp || new Date(),
      accuracy: accuracy || null
    });

    console.log(
      `✅ Location processed for session ${sessionId} - status: ${result.body.skipped ? 'skipped' : 'saved'}`
    );

    return res.status(result.status).json(result.body);
  } catch (err) {
    console.log('❌ Error updating location:', err);
    res.status(500).json({ 
      success: false,
      message: "Error updating location",
      error: err.message 
    });
  }
});

// ✅ BATCH SYNC - used by the app to flush points queued while offline
router.post("/batch-sync", async (req, res) => {
  try {
    const { points } = req.body;

    if (!Array.isArray(points) || points.length === 0) {
      return res.status(400).json({ message: "points array is required" });
    }

    console.log(`📦 Batch sync: ${points.length} points`);

    // ✅ Process in chronological order
    const sorted = [...points].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
    );

    const results = [];
    let savedCount = 0;
    let skippedCount = 0;

    for (const point of sorted) {
      const { userId, sessionId, latitude, longitude, timestamp, accuracy } = point;

      if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
        results.push({ success: false, message: 'Missing required fields', point });
        continue;
      }

      try {
        const result = await processLocationPoint({
          userId,
          sessionId,
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          timestamp: timestamp || new Date(),
          accuracy: accuracy || null
        });
        
        if (result.body.skipped) {
          skippedCount++;
        } else {
          savedCount++;
        }
        
        results.push({ success: true, ...result.body });
      } catch (pointErr) {
        console.log('❌ Error processing batched point:', pointErr.message);
        results.push({ success: false, message: pointErr.message, point });
      }
    }

    res.json({ 
      success: true, 
      saved: savedCount,
      skipped: skippedCount,
      total: sorted.length,
      results 
    });
  } catch (err) {
    console.log('❌ Error in batch-sync:', err);
    res.status(500).json({ 
      success: false,
      message: "Error syncing offline points",
      error: err.message 
    });
  }
});

// ✅ GET ALL LOCATIONS FOR SESSION
router.get("/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
    const skip = (page - 1) * limit;

    // ✅ Verify session exists
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    const [locations, total] = await Promise.all([
      Location.find({ sessionId })
        .sort({ timestamp: 1 })
        .skip(skip)
        .limit(limit),
      Location.countDocuments({ sessionId }),
    ]);

    res.json({
      success: true,
      sessionId,
      locations,
      total,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });

  } catch (err) {
    console.log('❌ Error fetching locations:', err);
    res.status(500).json({ 
      success: false,
      message: "Error fetching locations",
      error: err.message 
    });
  }
});

// ✅ GET LATEST LOCATION FOR SESSION
router.get("/latest/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ message: 'sessionId is required' });
    }

    // ✅ Verify session exists
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    const location = await Location.findOne({ sessionId })
      .sort({ timestamp: -1 });

    if (!location) {
      return res.status(404).json({ message: 'No locations found for this session' });
    }

    res.json({
      success: true,
      location
    });

  } catch (err) {
    console.log('❌ Error fetching latest location:', err);
    res.status(500).json({
      success: false,
      message: "Error fetching latest location",
      error: err.message
    });
  }
});

// ✅ GET USER LOCATIONS
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;

    // ✅ Build filter
    const filter = { userId };
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = startDate;
      if (endDate) filter.timestamp.$lte = endDate;
    }

    const locations = await Location.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit);

    res.json({
      success: true,
      userId,
      count: locations.length,
      locations
    });

  } catch (err) {
    console.log('❌ Error fetching user locations:', err);
    res.status(500).json({
      success: false,
      message: "Error fetching user locations",
      error: err.message
    });
  }
});

// ✅ GET LOCATIONS BY DATE RANGE
router.get("/range/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ 
        message: "startDate and endDate are required (YYYY-MM-DD format)" 
      });
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const locations = await Location.find({
      userId,
      timestamp: { $gte: start, $lte: end }
    }).sort({ timestamp: 1 });

    res.json({
      success: true,
      userId,
      startDate: start,
      endDate: end,
      count: locations.length,
      locations
    });

  } catch (err) {
    console.log('❌ Error fetching date range locations:', err);
    res.status(500).json({
      success: false,
      message: "Error fetching locations by date range",
      error: err.message
    });
  }
});

// ✅ CLEAN UP DUPLICATE POINTS
router.post("/cleanup-duplicates/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    // ✅ Verify session exists
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    const points = await Location.find({ sessionId }).sort({ timestamp: 1 });

    const toDelete = [];
    let prev = null;

    for (const point of points) {
      if (prev && isDuplicatePoint(prev, point.latitude, point.longitude, point.timestamp)) {
        toDelete.push(point._id);
        continue;
      }
      prev = point;
    }

    if (toDelete.length > 0) {
      await Location.deleteMany({ _id: { $in: toDelete } });
    }

    res.json({ 
      success: true, 
      removed: toDelete.length,
      totalPoints: points.length,
      remaining: points.length - toDelete.length
    });
  } catch (err) {
    console.log('❌ Error cleaning up duplicates:', err);
    res.status(500).json({ 
      success: false,
      message: "Error cleaning up duplicates",
      error: err.message 
    });
  }
});

// ✅ DELETE LOCATION (admin only)
router.delete("/:locationId", async (req, res) => {
  try {
    const { locationId } = req.params;

    const location = await Location.findByIdAndDelete(locationId);
    if (!location) {
      return res.status(404).json({ message: 'Location not found' });
    }

    // ✅ Remove from session route
    const session = await Session.findById(location.sessionId);
    if (session) {
      session.route = session.route.filter(p => 
        p.latitude !== location.latitude || 
        p.longitude !== location.longitude ||
        new Date(p.timestamp).getTime() !== new Date(location.timestamp).getTime()
      );
      await session.save();
    }

    res.json({ 
      success: true,
      message: 'Location deleted successfully',
      locationId 
    });

  } catch (err) {
    console.log('❌ Error deleting location:', err);
    res.status(500).json({
      success: false,
      message: "Error deleting location",
      error: err.message
    });
  }
});

module.exports = router;

//-------- 01.08.2026 ------------------------
// const express = require("express");
// const router = express.Router();
// const Location = require("../models/LocationModel/Location");
// const Session = require("../models/FSEModel/Session");
// const calculateDistance = require("../utils/distance");

// // ── Constants for GPS filtering / dedup ─────────────────────────────────────
// const MAX_JUMP_METERS = 500;       // reject jumps larger than this within MAX_JUMP_WINDOW_MS
// const MAX_JUMP_WINDOW_MS = 5000;   // 5 seconds
// const MAX_PLAUSIBLE_SPEED_MPS = 55; // ~200 km/h ceiling for FSE ground travel
// const DUPLICATE_WINDOW_MS = 5000;   // 5 seconds
// const DUPLICATE_DISTANCE_METERS = 2; // treat as same point if within 2 meters

// const kmToMeters = km => km * 1000;

// // ── Determine if a new point should be rejected as a GPS jump/glitch ────────
// function isImpossibleJump(prevPoint, latitude, longitude, timestamp) {
//   if (!prevPoint) return { reject: false };

//   const distanceKm = calculateDistance(
//     prevPoint.latitude,
//     prevPoint.longitude,
//     latitude,
//     longitude,
//   );
//   const distanceMeters = kmToMeters(distanceKm);

//   const dtMs = new Date(timestamp) - new Date(prevPoint.timestamp);
//   const dtSeconds = dtMs / 1000;

//   if (dtSeconds <= 0) {
//     return { reject: false, distanceMeters, speedMps: null };
//   }

//   const speedMps = distanceMeters / dtSeconds;

//   // ✅ Reject if jump > 500m within a 5s window
//   if (distanceMeters > MAX_JUMP_METERS && dtMs <= MAX_JUMP_WINDOW_MS) {
//     return { reject: true, reason: 'GPS jump exceeds 500m within 5s', distanceMeters, speedMps };
//   }

//   // ✅ Reject physically impossible speeds
//   if (speedMps > MAX_PLAUSIBLE_SPEED_MPS) {
//     return { reject: true, reason: 'Implausible speed', distanceMeters, speedMps };
//   }

//   return { reject: false, distanceMeters, speedMps };
// }

// // ── Determine if a point is a duplicate of the last saved point ────────────
// function isDuplicatePoint(prevPoint, latitude, longitude, timestamp) {
//   if (!prevPoint) return false;

//   const dtMs = Math.abs(new Date(timestamp) - new Date(prevPoint.timestamp));
//   if (dtMs > DUPLICATE_WINDOW_MS) return false;

//   const distanceKm = calculateDistance(
//     prevPoint.latitude,
//     prevPoint.longitude,
//     latitude,
//     longitude,
//   );
//   const distanceMeters = kmToMeters(distanceKm);

//   return distanceMeters <= DUPLICATE_DISTANCE_METERS;
// }

// // ── Core point-processing logic shared by single + batch endpoints ─────────
// async function processLocationPoint({ userId, sessionId, latitude, longitude, timestamp }) {
//   const session = await Session.findById(sessionId);
//   if (!session) {
//     return { status: 404, body: { message: 'Session not found' } };
//   }

//   // ✅ The session's LOCKED startLocation is always the true anchor point.
//   //    route[0] is written once at /session/start and mirrors startLocation —
//   //    if the route array is ever empty (defensive fallback only; this should
//   //    not normally happen), fall back to startLocation itself so a stray
//   //    update can never be mistaken for a brand-new "first" point.
//   const lastRoutePoint = session.route.length > 0
//     ? session.route[session.route.length - 1]
//     : session.startLocation
//       ? { latitude: session.startLocation.latitude, longitude: session.startLocation.longitude, timestamp: session.startTime }
//       : null;

//   // ✅ Deduplication check
//   if (isDuplicatePoint(lastRoutePoint, latitude, longitude, timestamp)) {
//     return {
//       status: 200,
//       body: {
//         success: true,
//         skipped: true,
//         reason: 'duplicate',
//         totalDistance: session.totalDistanceKm,
//       },
//     };
//   }

//   // ✅ GPS jump / impossible-movement filter
//   const jumpCheck = isImpossibleJump(lastRoutePoint, latitude, longitude, timestamp);
//   if (jumpCheck.reject) {
//     console.log(`⚠️ Rejected GPS point for session ${sessionId}: ${jumpCheck.reason}`);
//     return {
//       status: 200,
//       body: {
//         success: true,
//         skipped: true,
//         reason: jumpCheck.reason,
//         totalDistance: session.totalDistanceKm,
//       },
//     };
//   }

//   // ✅ Save location to Location collection
//   const location = await Location.create({
//     userId,
//     sessionId,
//     latitude,
//     longitude,
//     timestamp: timestamp || new Date(),
//   });

//   // ✅ Calculate distance from previous location
//   let distanceIncrement = 0;
//   if (lastRoutePoint) {
//     distanceIncrement = calculateDistance(
//       lastRoutePoint.latitude,
//       lastRoutePoint.longitude,
//       latitude,
//       longitude,
//     );

//     if (distanceIncrement > 0.001) { // ~1 meter minimum
//       session.totalDistanceKm += distanceIncrement;
//     }
//   }

//   session.route.push({
//     latitude,
//     longitude,
//     timestamp: timestamp || new Date(),
//   });

//   await session.save();

//   return {
//     status: 200,
//     body: {
//       success: true,
//       distance: distanceIncrement,
//       totalDistance: session.totalDistanceKm,
//       location,
//     },
//   };
// }

// // ✅ UPDATE LOCATION AND CALCULATE DISTANCE
// router.post("/update", async (req, res) => {
//   try {
//     const { userId, sessionId, latitude, longitude, timestamp } = req.body;

//     if (!userId || !sessionId || !latitude || !longitude) {
//       return res.status(400).json({ message: "Missing required fields" });
//     }

//     const result = await processLocationPoint({
//       userId,
//       sessionId,
//       latitude,
//       longitude,
//       timestamp: timestamp || new Date(),
//     });

//     console.log(
//       `✅ Location processed for session ${sessionId} - status: ${result.body.skipped ? 'skipped' : 'saved'}`,
//     );

//     return res.status(result.status).json(result.body);
//   } catch (err) {
//     console.log('❌ Error updating location:', err);
//     res.status(500).json({ message: "Error updating location" });
//   }
// });

// // ✅ BATCH SYNC — used by the app to flush points queued while offline
// router.post("/batch-sync", async (req, res) => {
//   try {
//     const { points } = req.body;

//     if (!Array.isArray(points) || points.length === 0) {
//       return res.status(400).json({ message: "points array is required" });
//     }

//     // ✅ Process in chronological order so distance/jump checks stay meaningful
//     const sorted = [...points].sort(
//       (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
//     );

//     const results = [];
//     for (const point of sorted) {
//       const { userId, sessionId, latitude, longitude, timestamp } = point;

//       if (!userId || !sessionId || !latitude || !longitude) {
//         results.push({ success: false, message: 'Missing required fields', point });
//         continue;
//       }

//       try {
//         const result = await processLocationPoint({
//           userId,
//           sessionId,
//           latitude,
//           longitude,
//           timestamp: timestamp || new Date(),
//         });
//         results.push({ success: true, ...result.body });
//       } catch (pointErr) {
//         console.log('❌ Error processing batched point:', pointErr.message);
//         results.push({ success: false, message: pointErr.message, point });
//       }
//     }

//     res.json({ success: true, processed: results.length, results });
//   } catch (err) {
//     console.log('❌ Error in batch-sync:', err);
//     res.status(500).json({ message: "Error syncing offline points" });
//   }
// });

// // ✅ GET ALL LOCATIONS FOR SESSION
// router.get("/session/:sessionId", async (req, res) => {
//   try {
//     const { sessionId } = req.params;
//     const page = parseInt(req.query.page, 10) || 1;
//     const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
//     const skip = (page - 1) * limit;

//     const [locations, total] = await Promise.all([
//       Location.find({ sessionId })
//         .sort({ timestamp: 1 })
//         .skip(skip)
//         .limit(limit),
//       Location.countDocuments({ sessionId }),
//     ]);

//     res.json({
//       locations,
//       pagination: {
//         page,
//         limit,
//         total,
//         totalPages: Math.ceil(total / limit),
//       },
//     });

//   } catch (err) {
//     console.log('❌ Error fetching locations:', err);
//     res.status(500).json({ message: "Error fetching locations" });
//   }
// });

// // ✅ GET USER LOCATIONS
// router.get("/user/:userId", async (req, res) => {
//   try {
//     const { userId } = req.params;
//     const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

//     const locations = await Location.find({ userId })
//       .sort({ timestamp: -1 })
//       .limit(limit);

//     res.json(locations);

//   } catch (err) {
//     console.log('❌ Error fetching user locations:', err);
//     res.status(500).json({ message: "Error fetching user locations" });
//   }
// });

// // ✅ CLEAN UP DUPLICATE POINTS FOR A SESSION (maintenance utility)
// router.post("/cleanup-duplicates/:sessionId", async (req, res) => {
//   try {
//     const { sessionId } = req.params;

//     const points = await Location.find({ sessionId }).sort({ timestamp: 1 });

//     const toDelete = [];
//     let prev = null;

//     for (const point of points) {
//       if (prev && isDuplicatePoint(prev, point.latitude, point.longitude, point.timestamp)) {
//         toDelete.push(point._id);
//         continue;
//       }
//       prev = point;
//     }

//     if (toDelete.length > 0) {
//       await Location.deleteMany({ _id: { $in: toDelete } });
//     }

//     res.json({ success: true, removed: toDelete.length });
//   } catch (err) {
//     console.log('❌ Error cleaning up duplicates:', err);
//     res.status(500).json({ message: "Error cleaning up duplicates" });
//   }
// });

// module.exports = router;

// //++++++++ fse old -------------
// // const express = require("express");
// // const router = express.Router();
// // const Location = require("../models/LocationModel/Location");
// // const Session = require("../models/FSEModel/Session");
// // const calculateDistance = require("../utils/distance");

// // // ✅ UPDATE LOCATION AND CALCULATE DISTANCE
// // router.post("/update", async (req, res) => {
// //   try {
// //     const { userId, sessionId, latitude, longitude, timestamp } = req.body;

// //     if (!userId || !sessionId || !latitude || !longitude) {
// //       return res.status(400).json({ message: "Missing required fields" });
// //     }

// //     // ✅ Save location to Location collection
// //     const location = await Location.create({
// //       userId,
// //       sessionId,
// //       latitude,
// //       longitude,
// //       timestamp: timestamp || new Date()
// //     });

// //     // ✅ Get the session
// //     const session = await Session.findById(sessionId);

// //     if (!session) {
// //       return res.status(404).json({ message: "Session not found" });
// //     }

// //     // ✅ Calculate distance from previous location
// //     let distanceIncrement = 0;

// //     if (session.route.length > 0) {
// //       const lastPoint = session.route[session.route.length - 1];
      
// //       distanceIncrement = calculateDistance(
// //         lastPoint.latitude,
// //         lastPoint.longitude,
// //         latitude,
// //         longitude
// //       );

// //       // ✅ Only add distance if it's significant (avoid GPS jitter)
// //       if (distanceIncrement > 0.001) { // ~1 meter minimum
// //         session.totalDistanceKm += distanceIncrement;
// //       }
// //     }

// //     // ✅ Add new point to route
// //     session.route.push({
// //       latitude,
// //       longitude,
// //       timestamp: new Date()
// //     });

// //     // ✅ Save updated session
// //     await session.save();

// //     console.log(`✅ Location updated - Distance: ${distanceIncrement.toFixed(4)}km, Total: ${session.totalDistanceKm.toFixed(2)}km`);

// //     res.json({
// //       success: true,
// //       distance: distanceIncrement,
// //       totalDistance: session.totalDistanceKm,
// //       location: location
// //     });

// //   } catch (err) {
// //     console.log('❌ Error updating location:', err);
// //     res.status(500).json({ message: "Error updating location" });
// //   }
// // });

// // // ✅ GET ALL LOCATIONS FOR SESSION
// // router.get("/session/:sessionId", async (req, res) => {
// //   try {
// //     const { sessionId } = req.params;

// //     const locations = await Location.find({ sessionId })
// //       .sort({ timestamp: 1 });

// //     res.json(locations);

// //   } catch (err) {
// //     console.log('❌ Error fetching locations:', err);
// //     res.status(500).json({ message: "Error fetching locations" });
// //   }
// // });

// // // ✅ GET USER LOCATIONS
// // router.get("/user/:userId", async (req, res) => {
// //   try {
// //     const { userId } = req.params;

// //     const locations = await Location.find({ userId })
// //       .sort({ timestamp: -1 })
// //       .limit(100);

// //     res.json(locations);

// //   } catch (err) {
// //     console.log('❌ Error fetching user locations:', err);
// //     res.status(500).json({ message: "Error fetching user locations" });
// //   }
// // });

// // module.exports = router;
