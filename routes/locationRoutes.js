// locationRoutes.js

const express = require("express");
const router = express.Router();
const Location = require("../models/LocationModel/Location");
const Session = require("../models/FSEModel/Session");
const calculateDistance = require("../utils/distance");

const MAX_JUMP_METERS = 500;
const MAX_JUMP_WINDOW_MS = 5000;
const MAX_PLAUSIBLE_SPEED_MPS = 55;
const DUPLICATE_WINDOW_MS = 5000;
const DUPLICATE_DISTANCE_METERS = 2;

const kmToMeters = km => km * 1000;

const { runExclusive } = require("../utils/sessionLock");

function isImpossibleJump(prevPoint, latitude, longitude, timestamp) {
  if (!prevPoint) return { reject: false };
  const distanceKm = calculateDistance(prevPoint.latitude, prevPoint.longitude, latitude, longitude);
  const distanceMeters = kmToMeters(distanceKm);
  const dtMs = new Date(timestamp) - new Date(prevPoint.timestamp);
  const dtSeconds = dtMs / 1000;
  if (dtSeconds <= 0) return { reject: false, distanceMeters, speedMps: null };
  const speedMps = distanceMeters / dtSeconds;
  if (distanceMeters > MAX_JUMP_METERS && dtMs <= MAX_JUMP_WINDOW_MS) {
    return { reject: true, reason: 'GPS jump exceeds 500m within 5s', distanceMeters, speedMps };
  }
  if (speedMps > MAX_PLAUSIBLE_SPEED_MPS) {
    return { reject: true, reason: 'Implausible speed', distanceMeters, speedMps };
  }
  return { reject: false, distanceMeters, speedMps };
}

function isDuplicatePoint(prevPoint, latitude, longitude, timestamp) {
  if (!prevPoint) return false;
  const dtMs = Math.abs(new Date(timestamp) - new Date(prevPoint.timestamp));
  if (dtMs > DUPLICATE_WINDOW_MS) return false;
  const distanceKm = calculateDistance(prevPoint.latitude, prevPoint.longitude, latitude, longitude);
  return kmToMeters(distanceKm) <= DUPLICATE_DISTANCE_METERS;
}

async function processLocationPoint({ userId, sessionId, latitude, longitude, timestamp }) {
  if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
    console.error('❌ Invalid location point data:', { userId, sessionId, latitude, longitude });
    return { status: 400, body: { message: 'Missing required fields' } };
  }

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  if (isNaN(lat) || isNaN(lng)) {
    console.error('❌ Invalid coordinates:', { latitude, longitude });
    return { status: 400, body: { message: 'Invalid coordinates' } };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    console.error('❌ Coordinates out of range:', { lat, lng });
    return { status: 400, body: { message: 'Coordinates out of range' } };
  }

  const session = await Session.findById(sessionId);
  if (!session) {
    console.error('❌ Session not found:', sessionId);
    return { status: 404, body: { message: 'Session not found' } };
  }
  if (session.status !== 'ACTIVE') {
    console.warn(`⚠️ Session ${sessionId} is not active (status: ${session.status})`);
    return { status: 400, body: { message: 'Session is not active' } };
  }

  const lastRoutePoint = session.route.length > 0
    ? session.route[session.route.length - 1]
    : session.startLocation
      ? { latitude: session.startLocation.latitude, longitude: session.startLocation.longitude, timestamp: session.startTime }
      : null;

  if (lastRoutePoint && isDuplicatePoint(lastRoutePoint, lat, lng, timestamp)) {
    console.log(`⏭️ Duplicate point skipped session=${sessionId}`);
    return { status: 200, body: { success: true, skipped: true, reason: 'duplicate', totalDistance: session.totalDistanceKm || 0, pointCount: session.pointCount || 0 } };
  }

  if (lastRoutePoint) {
    const jumpCheck = isImpossibleJump(lastRoutePoint, lat, lng, timestamp);
    if (jumpCheck.reject) {
      console.log(`⏭️ Rejected GPS point session=${sessionId}: ${jumpCheck.reason}`);
      return { status: 200, body: { success: true, skipped: true, reason: jumpCheck.reason, totalDistance: session.totalDistanceKm || 0, pointCount: session.pointCount || 0 } };
    }
  }

  const location = await Location.create({
    userId, sessionId, latitude: lat, longitude: lng, timestamp: timestamp || new Date(),
  });

  let distanceIncrement = 0;
  if (lastRoutePoint) {
    distanceIncrement = calculateDistance(lastRoutePoint.latitude, lastRoutePoint.longitude, lat, lng);
    if (distanceIncrement <= 0.0001) distanceIncrement = 0;
  }

  const updatedSession = await Session.findByIdAndUpdate(
    sessionId,
    {
      $push: { route: { latitude: lat, longitude: lng, timestamp: timestamp || new Date() } },
      $inc: { totalDistanceKm: parseFloat(distanceIncrement.toFixed(6)), pointCount: 1 },
    },
    { new: true },
  );

  const roundedTotal = parseFloat((updatedSession.totalDistanceKm || 0).toFixed(4));
  if (roundedTotal !== updatedSession.totalDistanceKm) {
    await Session.findByIdAndUpdate(sessionId, { totalDistanceKm: roundedTotal });
  }

  console.log(`💾 Location saved session=${sessionId} pointCount=${updatedSession.pointCount}`);
  console.log(`📏 Distance increment=${distanceIncrement.toFixed(4)}km total=${roundedTotal.toFixed(4)}km`);

  return {
    status: 200,
    body: {
      success: true,
      distance: distanceIncrement,
      totalDistance: roundedTotal,
      pointCount: updatedSession.pointCount,
      location,
    },
  };
}

// ✅ Single place responsible for broadcasting an accepted point.
// Only called for genuinely accepted (non-skipped, non-error) points.
function broadcastAcceptedPoint(req, { userId, sessionId, latitude, longitude, timestamp, totalDistance, pointCount }) {
  if (!req.io) {
    console.warn('⚠️ req.io not available — skipping live broadcast');
    return;
  }
  const payload = {
    sessionId,
    userId,
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    timestamp: timestamp || new Date(),
    totalDistanceKm: totalDistance,
    pointCount,
  };
  try {
    req.io.to(`session-${sessionId}`).emit('session-location', payload);
    req.io.emit('users-location', payload); // legacy/global listeners
    console.log(`📡 Socket broadcast sent session=${sessionId} pointCount=${pointCount} totalDistanceKm=${totalDistance}`);
  } catch (emitErr) {
    console.log(`❌ Socket broadcast failed session=${sessionId}:`, emitErr.message);
  }
}

router.post("/update", async (req, res) => {
  try {
    const { userId, sessionId, latitude, longitude, timestamp } = req.body;

    if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        message: "Missing required fields",
        required: ['userId', 'sessionId', 'latitude', 'longitude']
      });
    }

    console.log(`📍 GPS received session=${sessionId} lat=${latitude} lng=${longitude}`);

    const result = await runExclusive(sessionId, () =>
      processLocationPoint({ userId, sessionId, latitude, longitude, timestamp: timestamp || new Date() }),
    );

    if (result.status === 200 && result.body?.success && !result.body.skipped) {
      console.log(`✅ Location accepted session=${sessionId}`);
      broadcastAcceptedPoint(req, {
        userId, sessionId, latitude, longitude, timestamp,
        totalDistance: result.body.totalDistance,
        pointCount: result.body.pointCount,
      });
    }

    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('❌ Error updating location:', err);
    res.status(500).json({ message: "Error updating location", error: err.message });
  }
});

router.post("/batch-sync", async (req, res) => {
  try {
    const { points } = req.body;
    if (!Array.isArray(points) || points.length === 0) {
      return res.status(400).json({ message: "points array is required" });
    }

    const sorted = [...points].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
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
        const result = await runExclusive(sessionId, () =>
          processLocationPoint({ userId, sessionId, latitude, longitude, timestamp: timestamp || new Date() }),
        );

        if (result.body.success !== false) successCount++;

        if (result.status === 200 && result.body?.success && !result.body.skipped) {
          broadcastAcceptedPoint(req, {
            userId, sessionId, latitude, longitude, timestamp,
            totalDistance: result.body.totalDistance,
            pointCount: result.body.pointCount,
          });
        }

        results.push({ success: true, ...result.body });
      } catch (pointErr) {
        console.error('❌ Error processing batched point:', pointErr.message);
        results.push({ success: false, message: pointErr.message, point });
      }
    }

    console.log(`✅ Batch sync complete: ${successCount}/${sorted.length} points processed`);
    res.json({ success: true, processed: results.length, successful: successCount, results });
  } catch (err) {
    console.error('❌ Error in batch-sync:', err);
    res.status(500).json({ message: "Error syncing offline points" });
  }
});

router.get("/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
    const skip = (page - 1) * limit;

    const [locations, total] = await Promise.all([
      Location.find({ sessionId }).sort({ timestamp: 1 }).skip(skip).limit(limit),
      Location.countDocuments({ sessionId }),
    ]);

    res.json({ locations, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('❌ Error fetching locations:', err);
    res.status(500).json({ message: "Error fetching locations" });
  }
});

router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const locations = await Location.find({ userId }).sort({ timestamp: -1 }).limit(limit);
    res.json(locations);
  } catch (err) {
    console.error('❌ Error fetching user locations:', err);
    res.status(500).json({ message: "Error fetching user locations" });
  }
});

router.post("/recalculate/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const locations = await Location.find({ sessionId }).sort({ timestamp: 1 }).lean();

    if (locations.length < 2) {
      return res.json({ success: true, message: 'Not enough points to calculate distance', distance: 0, pointCount: locations.length });
    }

    let totalDistance = 0;
    for (let i = 1; i < locations.length; i++) {
      totalDistance += calculateDistance(
        locations[i - 1].latitude, locations[i - 1].longitude,
        locations[i].latitude, locations[i].longitude,
      );
    }

    const session = await Session.findByIdAndUpdate(
      sessionId,
      { totalDistanceKm: parseFloat(totalDistance.toFixed(4)), pointCount: locations.length },
      { new: true }
    );

    res.json({ success: true, pointCount: locations.length, distance: parseFloat(totalDistance.toFixed(4)), session });
  } catch (err) {
    console.error('❌ Error recalculating distance:', err);
    res.status(500).json({ message: "Error recalculating distance" });
  }
});

module.exports = router;

//-------------- 08.08.2026 --------------------
// // locationRoutes.js - COMPLETE PRODUCTION VERSION

// const express = require("express");
// const router = express.Router();
// const Location = require("../models/LocationModel/Location");
// const Session = require("../models/FSEModel/Session");
// const calculateDistance = require("../utils/distance");

// // ── Constants for GPS filtering / dedup ─────────────────────────────────────
// const MAX_JUMP_METERS = 500;
// const MAX_JUMP_WINDOW_MS = 5000;
// const MAX_PLAUSIBLE_SPEED_MPS = 55;
// const DUPLICATE_WINDOW_MS = 5000;
// const DUPLICATE_DISTANCE_METERS = 2;

// const kmToMeters = km => km * 1000;

// // GPS points fire every 1-3s and can overlap in-flight with each other (plus
// // the 15s emergency ping and offline-queue flushes). runExclusive() makes
// // sure only one point is ever read-modified-written at a time per session —
// // see utils/sessionLock.js for why this matters.
// const { runExclusive } = require("../utils/sessionLock");

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

//   if (distanceMeters > MAX_JUMP_METERS && dtMs <= MAX_JUMP_WINDOW_MS) {
//     return { reject: true, reason: 'GPS jump exceeds 500m within 5s', distanceMeters, speedMps };
//   }

//   if (speedMps > MAX_PLAUSIBLE_SPEED_MPS) {
//     return { reject: true, reason: 'Implausible speed', distanceMeters, speedMps };
//   }

//   return { reject: false, distanceMeters, speedMps };
// }

// // ── Determine if a point is a duplicate ──────────────────────────────────────
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

// // ── Core point-processing logic ──────────────────────────────────────────────
// async function processLocationPoint({ userId, sessionId, latitude, longitude, timestamp }) {
//   // ✅ Validate inputs
//   if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
//     console.error('❌ Invalid location point data:', { userId, sessionId, latitude, longitude });
//     return { status: 400, body: { message: 'Missing required fields' } };
//   }

//   // ✅ Parse and validate coordinates
//   const lat = parseFloat(latitude);
//   const lng = parseFloat(longitude);
  
//   if (isNaN(lat) || isNaN(lng)) {
//     console.error('❌ Invalid coordinates:', { latitude, longitude });
//     return { status: 400, body: { message: 'Invalid coordinates' } };
//   }

//   // ✅ Validate coordinate range
//   if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
//     console.error('❌ Coordinates out of range:', { lat, lng });
//     return { status: 400, body: { message: 'Coordinates out of range' } };
//   }

//   const session = await Session.findById(sessionId);
//   if (!session) {
//     console.error('❌ Session not found:', sessionId);
//     return { status: 404, body: { message: 'Session not found' } };
//   }

//   // ✅ Check if session is active
//   if (session.status !== 'ACTIVE') {
//     console.warn(`⚠️ Session ${sessionId} is not active (status: ${session.status})`);
//     return { status: 400, body: { message: 'Session is not active' } };
//   }

//   // ✅ Get the last route point
//   const lastRoutePoint = session.route.length > 0
//     ? session.route[session.route.length - 1]
//     : session.startLocation
//       ? { latitude: session.startLocation.latitude, longitude: session.startLocation.longitude, timestamp: session.startTime }
//       : null;

//   // ✅ Deduplication check
//   if (lastRoutePoint && isDuplicatePoint(lastRoutePoint, lat, lng, timestamp)) {
//     console.log(`📌 Duplicate point skipped for session ${sessionId}`);
//     return {
//       status: 200,
//       body: {
//         success: true,
//         skipped: true,
//         reason: 'duplicate',
//         totalDistance: session.totalDistanceKm || 0,
//       },
//     };
//   }

//   // ✅ GPS jump / impossible-movement filter
//   if (lastRoutePoint) {
//     const jumpCheck = isImpossibleJump(lastRoutePoint, lat, lng, timestamp);
//     if (jumpCheck.reject) {
//       console.log(`⚠️ Rejected GPS point for session ${sessionId}: ${jumpCheck.reason}`);
//       return {
//         status: 200,
//         body: {
//           success: true,
//           skipped: true,
//           reason: jumpCheck.reason,
//           totalDistance: session.totalDistanceKm || 0,
//         },
//       };
//     }
//   }

//   // ✅ Save location to Location collection
//   const location = await Location.create({
//     userId,
//     sessionId,
//     latitude: lat,
//     longitude: lng,
//     timestamp: timestamp || new Date(),
//   });

//   // ✅ Calculate distance from previous location
//   let distanceIncrement = 0;
//   if (lastRoutePoint) {
//     distanceIncrement = calculateDistance(
//       lastRoutePoint.latitude,
//       lastRoutePoint.longitude,
//       lat,
//       lng,
//     );

//     if (distanceIncrement <= 0.0001) {
//       console.log(`📏 Distance too small to add: ${distanceIncrement.toFixed(6)}km`);
//       distanceIncrement = 0;
//     }
//   }

//   // ✅ Update session atomically: $push the new point and $inc the distance
//   // and point counter in a single write, instead of the old
//   // read -> mutate-in-JS -> save() pattern. That old pattern is what let
//   // concurrent GPS updates silently overwrite each other's route/distance
//   // changes (see the runExclusive() note above the mutex code). $push/$inc
//   // are atomic at the MongoDB level, and combined with the per-session
//   // mutex serializing requests, this guarantees every accepted point is
//   // reflected exactly once in both the route array and totalDistanceKm.
//   const updatedSession = await Session.findByIdAndUpdate(
//     sessionId,
//     {
//       $push: {
//         route: { latitude: lat, longitude: lng, timestamp: timestamp || new Date() },
//       },
//       $inc: {
//         totalDistanceKm: parseFloat(distanceIncrement.toFixed(6)),
//         pointCount: 1,
//       },
//     },
//     { new: true },
//   );

//   const roundedTotal = parseFloat((updatedSession.totalDistanceKm || 0).toFixed(4));
//   if (roundedTotal !== updatedSession.totalDistanceKm) {
//     // Keep the stored value tidy (avoid float drift accumulating over thousands of points)
//     await Session.findByIdAndUpdate(sessionId, { totalDistanceKm: roundedTotal });
//   }

//   console.log(`✅ Location saved for session ${sessionId}: ${updatedSession.pointCount} points, ${roundedTotal.toFixed(4)}km`);

//   return {
//     status: 200,
//     body: {
//       success: true,
//       distance: distanceIncrement,
//       totalDistance: roundedTotal,
//       pointCount: updatedSession.pointCount,
//       location,
//     },
//   };
// }

// // ✅ UPDATE LOCATION AND CALCULATE DISTANCE
// router.post("/update", async (req, res) => {
//   try {
//     const { userId, sessionId, latitude, longitude, timestamp } = req.body;

//     if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
//       return res.status(400).json({ 
//         message: "Missing required fields",
//         required: ['userId', 'sessionId', 'latitude', 'longitude']
//       });
//     }

//     console.log(`📥 Location update request:`);
//     console.log(`  Session: ${sessionId}`);
//     console.log(`  Location: ${latitude}, ${longitude}`);
//     console.log(`  Timestamp: ${timestamp || new Date().toISOString()}`);

//     const result = await runExclusive(sessionId, () =>
//       processLocationPoint({
//         userId,
//         sessionId,
//         latitude,
//         longitude,
//         timestamp: timestamp || new Date(),
//       }),
//     );

//     return res.status(result.status).json(result.body);
//   } catch (err) {
//     console.error('❌ Error updating location:', err);
//     res.status(500).json({ 
//       message: "Error updating location",
//       error: err.message 
//     });
//   }
// });

// // ✅ BATCH SYNC — used by the app to flush points queued while offline
// router.post("/batch-sync", async (req, res) => {
//   try {
//     const { points } = req.body;

//     if (!Array.isArray(points) || points.length === 0) {
//       return res.status(400).json({ message: "points array is required" });
//     }

//     // ✅ Process in chronological order
//     const sorted = [...points].sort(
//       (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
//     );

//     console.log(`📦 Batch sync: ${sorted.length} points`);

//     const results = [];
//     let successCount = 0;

//     for (const point of sorted) {
//       const { userId, sessionId, latitude, longitude, timestamp } = point;

//       if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
//         results.push({ success: false, message: 'Missing required fields', point });
//         continue;
//       }

//       try {
//         const result = await runExclusive(sessionId, () =>
//           processLocationPoint({
//             userId,
//             sessionId,
//             latitude,
//             longitude,
//             timestamp: timestamp || new Date(),
//           }),
//         );
        
//         if (result.body.success !== false) {
//           successCount++;
//         }
//         results.push({ success: true, ...result.body });
//       } catch (pointErr) {
//         console.error('❌ Error processing batched point:', pointErr.message);
//         results.push({ success: false, message: pointErr.message, point });
//       }
//     }

//     console.log(`✅ Batch sync complete: ${successCount}/${sorted.length} points processed`);

//     res.json({ 
//       success: true, 
//       processed: results.length,
//       successful: successCount,
//       results 
//     });
//   } catch (err) {
//     console.error('❌ Error in batch-sync:', err);
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
//     console.error('❌ Error fetching locations:', err);
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
//     console.error('❌ Error fetching user locations:', err);
//     res.status(500).json({ message: "Error fetching user locations" });
//   }
// });

// // ✅ RECALCULATE DISTANCE FOR A SESSION (maintenance utility)
// router.post("/recalculate/:sessionId", async (req, res) => {
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

//     // Update session
//     const session = await Session.findByIdAndUpdate(
//       sessionId,
//       {
//         totalDistanceKm: parseFloat(totalDistance.toFixed(4)),
//         pointCount: locations.length,
//       },
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

// module.exports = router;
