// locationRoutes.js - COMPLETE PRODUCTION VERSION

const express = require("express");
const router = express.Router();
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

// ── Determine if a point is a duplicate ──────────────────────────────────────
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

// ── Core point-processing logic ──────────────────────────────────────────────
async function processLocationPoint({ userId, sessionId, latitude, longitude, timestamp }) {
  // ✅ Validate inputs
  if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
    console.error('❌ Invalid location point data:', { userId, sessionId, latitude, longitude });
    return { status: 400, body: { message: 'Missing required fields' } };
  }

  // ✅ Parse and validate coordinates
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  
  if (isNaN(lat) || isNaN(lng)) {
    console.error('❌ Invalid coordinates:', { latitude, longitude });
    return { status: 400, body: { message: 'Invalid coordinates' } };
  }

  // ✅ Validate coordinate range
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    console.error('❌ Coordinates out of range:', { lat, lng });
    return { status: 400, body: { message: 'Coordinates out of range' } };
  }

  const session = await Session.findById(sessionId);
  if (!session) {
    console.error('❌ Session not found:', sessionId);
    return { status: 404, body: { message: 'Session not found' } };
  }

  // ✅ Check if session is active
  if (session.status !== 'ACTIVE') {
    console.warn(`⚠️ Session ${sessionId} is not active (status: ${session.status})`);
    return { status: 400, body: { message: 'Session is not active' } };
  }

  // ✅ Get the last route point
  const lastRoutePoint = session.route.length > 0
    ? session.route[session.route.length - 1]
    : session.startLocation
      ? { latitude: session.startLocation.latitude, longitude: session.startLocation.longitude, timestamp: session.startTime }
      : null;

  // ✅ Deduplication check
  if (lastRoutePoint && isDuplicatePoint(lastRoutePoint, lat, lng, timestamp)) {
    console.log(`📌 Duplicate point skipped for session ${sessionId}`);
    return {
      status: 200,
      body: {
        success: true,
        skipped: true,
        reason: 'duplicate',
        totalDistance: session.totalDistanceKm || 0,
      },
    };
  }

  // ✅ GPS jump / impossible-movement filter
  if (lastRoutePoint) {
    const jumpCheck = isImpossibleJump(lastRoutePoint, lat, lng, timestamp);
    if (jumpCheck.reject) {
      console.log(`⚠️ Rejected GPS point for session ${sessionId}: ${jumpCheck.reason}`);
      return {
        status: 200,
        body: {
          success: true,
          skipped: true,
          reason: jumpCheck.reason,
          totalDistance: session.totalDistanceKm || 0,
        },
      };
    }
  }

  // ✅ Save location to Location collection
  const location = await Location.create({
    userId,
    sessionId,
    latitude: lat,
    longitude: lng,
    timestamp: timestamp || new Date(),
  });

  // ✅ Calculate distance from previous location
  let distanceIncrement = 0;
  let totalDistance = session.totalDistanceKm || 0;

  if (lastRoutePoint) {
    distanceIncrement = calculateDistance(
      lastRoutePoint.latitude,
      lastRoutePoint.longitude,
      lat,
      lng,
    );

    // ✅ Always add distance, even if very small
    if (distanceIncrement > 0.0001) {
      totalDistance = totalDistance + distanceIncrement;
      console.log(`📏 Distance increment: ${distanceIncrement.toFixed(4)}km, Total: ${totalDistance.toFixed(4)}km`);
    } else {
      console.log(`📏 Distance too small to add: ${distanceIncrement.toFixed(6)}km`);
    }
  }

  // ✅ Update session with route and distance
  session.route.push({
    latitude: lat,
    longitude: lng,
    timestamp: timestamp || new Date(),
  });
  session.totalDistanceKm = parseFloat(totalDistance.toFixed(4));
  
  await session.save();

  console.log(`✅ Location saved for session ${sessionId}: ${session.route.length} points, ${session.totalDistanceKm.toFixed(4)}km`);

  return {
    status: 200,
    body: {
      success: true,
      distance: distanceIncrement,
      totalDistance: session.totalDistanceKm,
      pointCount: session.route.length,
      location,
    },
  };
}

// ✅ UPDATE LOCATION AND CALCULATE DISTANCE
router.post("/update", async (req, res) => {
  try {
    const { userId, sessionId, latitude, longitude, timestamp } = req.body;

    if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ 
        message: "Missing required fields",
        required: ['userId', 'sessionId', 'latitude', 'longitude']
      });
    }

    console.log(`📥 Location update request:`);
    console.log(`  Session: ${sessionId}`);
    console.log(`  Location: ${latitude}, ${longitude}`);
    console.log(`  Timestamp: ${timestamp || new Date().toISOString()}`);

    const result = await processLocationPoint({
      userId,
      sessionId,
      latitude,
      longitude,
      timestamp: timestamp || new Date(),
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('❌ Error updating location:', err);
    res.status(500).json({ 
      message: "Error updating location",
      error: err.message 
    });
  }
});

// ✅ BATCH SYNC — used by the app to flush points queued while offline
router.post("/batch-sync", async (req, res) => {
  try {
    const { points } = req.body;

    if (!Array.isArray(points) || points.length === 0) {
      return res.status(400).json({ message: "points array is required" });
    }

    // ✅ Process in chronological order
    const sorted = [...points].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
    );

    console.log(`📦 Batch sync: ${sorted.length} points`);

    const results = [];
    let successCount = 0;

    for (const point of sorted) {
      const { userId, sessionId, latitude, longitude, timestamp } = point;

      if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
        results.push({ success: false, message: 'Missing required fields', point });
        continue;
      }

      try {
        const result = await processLocationPoint({
          userId,
          sessionId,
          latitude,
          longitude,
          timestamp: timestamp || new Date(),
        });
        
        if (result.body.success !== false) {
          successCount++;
        }
        results.push({ success: true, ...result.body });
      } catch (pointErr) {
        console.error('❌ Error processing batched point:', pointErr.message);
        results.push({ success: false, message: pointErr.message, point });
      }
    }

    console.log(`✅ Batch sync complete: ${successCount}/${sorted.length} points processed`);

    res.json({ 
      success: true, 
      processed: results.length,
      successful: successCount,
      results 
    });
  } catch (err) {
    console.error('❌ Error in batch-sync:', err);
    res.status(500).json({ message: "Error syncing offline points" });
  }
});

// ✅ GET ALL LOCATIONS FOR SESSION
router.get("/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
    const skip = (page - 1) * limit;

    const [locations, total] = await Promise.all([
      Location.find({ sessionId })
        .sort({ timestamp: 1 })
        .skip(skip)
        .limit(limit),
      Location.countDocuments({ sessionId }),
    ]);

    res.json({
      locations,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });

  } catch (err) {
    console.error('❌ Error fetching locations:', err);
    res.status(500).json({ message: "Error fetching locations" });
  }
});

// ✅ GET USER LOCATIONS
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    const locations = await Location.find({ userId })
      .sort({ timestamp: -1 })
      .limit(limit);

    res.json(locations);

  } catch (err) {
    console.error('❌ Error fetching user locations:', err);
    res.status(500).json({ message: "Error fetching user locations" });
  }
});

// ✅ RECALCULATE DISTANCE FOR A SESSION (maintenance utility)
router.post("/recalculate/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    const locations = await Location.find({ sessionId })
      .sort({ timestamp: 1 })
      .lean();

    if (locations.length < 2) {
      return res.json({ 
        success: true, 
        message: 'Not enough points to calculate distance',
        distance: 0,
        pointCount: locations.length
      });
    }

    let totalDistance = 0;
    for (let i = 1; i < locations.length; i++) {
      const prev = locations[i - 1];
      const curr = locations[i];
      const dist = calculateDistance(
        prev.latitude,
        prev.longitude,
        curr.latitude,
        curr.longitude,
      );
      totalDistance += dist;
    }

    // Update session
    const session = await Session.findByIdAndUpdate(
      sessionId,
      { totalDistanceKm: parseFloat(totalDistance.toFixed(4)) },
      { new: true }
    );

    res.json({
      success: true,
      pointCount: locations.length,
      distance: parseFloat(totalDistance.toFixed(4)),
      session
    });

  } catch (err) {
    console.error('❌ Error recalculating distance:', err);
    res.status(500).json({ message: "Error recalculating distance" });
  }
});

module.exports = router;

//================ working code of 80 percentage (04.08.26) ====================
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

