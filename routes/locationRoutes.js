const express = require("express");
const router = express.Router();
const Location = require("../models/LocationModel/Location");
const Session = require("../models/FSEModel/Session");
const calculateDistance = require("../utils/distance");

const MAX_ACCEPTABLE_ACCURACY_METERS = 150;
const MAX_JUMP_METERS = 2000;
const MAX_JUMP_WINDOW_MS = 10000;
const MAX_PLAUSIBLE_SPEED_MPS = 100;
const DUPLICATE_WINDOW_MS = 3000;
const DUPLICATE_DISTANCE_METERS = 1;

const kmToMeters = km => km * 1000;
const { runExclusive } = require("../utils/sessionLock");

// ── Route rebuild helper ──────────────────────────────────────────────
async function rebuildSessionRoute(sessionId) {
  try {
    console.log(`🔄 Rebuilding route for session ${sessionId}`);
    
    const locations = await Location.find({ sessionId })
      .sort({ timestamp: 1 })
      .lean();

    if (locations.length === 0) {
      console.log(`⚠️ No locations found for session ${sessionId}`);
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

    // ✅ FIX: This function rebuilds the ENTIRE route from the Location
    // collection (the real source of truth), so it must SET the route/
    // totals directly — not $inc/$push, which was referencing undefined
    // variables (distanceIncrement/lat/lng/timestamp) and threw a
    // ReferenceError on every call, silently killing route persistence
    // during active tracking (caught by the catch block below).
    const updatedSession = await Session.findByIdAndUpdate(
      sessionId,
      {
        route: route,
        totalDistanceKm: parseFloat(totalDistance.toFixed(4)),
        pointCount: locations.length,
      },
      { new: true }
    );

    console.log(`✅ Route rebuilt: ${locations.length} points, ${totalDistance.toFixed(4)}km`);
    return updatedSession;
  } catch (err) {
    console.error(`❌ Failed to rebuild route for session ${sessionId}:`, err.message);
    return null;
  }
}

// ── Determine if a new point should be rejected as a GPS jump ────────
function isImpossibleJump(prevPoint, latitude, longitude, timestamp) {
  if (!prevPoint) return { reject: false };

  const distanceKm = calculateDistance(
    prevPoint.latitude, prevPoint.longitude,
    latitude, longitude
  );
  const distanceMeters = kmToMeters(distanceKm);

  const dtMs = new Date(timestamp) - new Date(prevPoint.timestamp);
  const dtSeconds = dtMs / 1000;

  if (dtSeconds <= 0) {
    return { reject: false, distanceMeters, speedMps: null };
  }

  const speedMps = distanceMeters / dtSeconds;

  if (distanceMeters > MAX_JUMP_METERS && dtMs <= MAX_JUMP_WINDOW_MS) {
    return { reject: true, reason: 'GPS jump exceeds 2km within 10s', distanceMeters, speedMps };
  }

  if (speedMps > MAX_PLAUSIBLE_SPEED_MPS) {
    return { reject: true, reason: 'Implausible speed', distanceMeters, speedMps };
  }

  return { reject: false, distanceMeters, speedMps };
}

// ── Determine if a point is a duplicate ─────────────────────────────────
function isDuplicatePoint(prevPoint, latitude, longitude, timestamp) {
  if (!prevPoint) return false;

  const dtMs = Math.abs(new Date(timestamp) - new Date(prevPoint.timestamp));
  if (dtMs > DUPLICATE_WINDOW_MS) return false;

  const distanceKm = calculateDistance(
    prevPoint.latitude, prevPoint.longitude,
    latitude, longitude
  );
  const distanceMeters = kmToMeters(distanceKm);

  return distanceMeters <= DUPLICATE_DISTANCE_METERS;
}

// // ─── BROADCAST HELPER ──────────────────────────────────────────────────
// function broadcastAcceptedPoint(req, { sessionId, userId, latitude, longitude, timestamp, totalDistance, pointCount }) {
//   if (!req.io) {
//     console.warn('⚠️ req.io not available — skipping live broadcast');
//     return false;
//   }
  
//   const payload = {
//     sessionId,
//     userId,
//     latitude: parseFloat(latitude),
//     longitude: parseFloat(longitude),
//     timestamp: timestamp || new Date(),
//     totalDistanceKm: parseFloat(totalDistance || 0),
//     pointCount: parseInt(pointCount || 0),
//     isCached: false,
//   };
  
//   try {
//     req.io.to(`session-${sessionId}`).emit('session-location', payload);
//     req.io.emit('users-location', payload);
//     console.log(`📡 Socket broadcast sent session=${sessionId} pointCount=${pointCount} totalDistanceKm=${totalDistance}`);
//     return true;
//   } catch (emitErr) {
//     console.log(`❌ Socket broadcast failed session=${sessionId}:`, emitErr.message);
//     return false;
//   }
// }

function broadcastAcceptedPoint(req, { sessionId, userId, latitude, longitude, timestamp, totalDistance, pointCount }) {
  if (!req.io) return false;
  const payload = {
    sessionId: String(sessionId),
    userId: String(userId),
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    timestamp: timestamp || new Date(),
    totalDistanceKm: parseFloat(totalDistance || 0),
    pointCount: parseInt(pointCount || 0),
    isCached: false,
  };
  try {
    req.io.to(`session-${sessionId}`).emit('session-location', payload);
    req.io.emit('users-location', payload);
    return true;
  } catch (e) { return false; }
}

// ── Core point-processing logic ──────────────────────────────────────────
async function processLocationPoint({ userId, sessionId, latitude, longitude, accuracy, timestamp }) {
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

  const accuracyNum = parseFloat(accuracy);
  if (accuracyNum > MAX_ACCEPTABLE_ACCURACY_METERS) {
    console.log(`⚠️ Low GPS accuracy: ${accuracyNum}m (still accepting)`);
  }

  const session = await Session.findById(sessionId);
  if (!session) {
    console.error('❌ Session not found:', sessionId);
    return { status: 404, body: { message: 'Session not found' } };
  }

  if (session.status !== 'ACTIVE') {
    console.warn(`⚠️ Session ${sessionId} is not active (status: ${session.status})`);
    
    if (session.status === 'AUTO_ENDED') {
      console.log(`🔄 Attempting to reactivate AUTO_ENDED session ${sessionId}`);
      const now = new Date();
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      
      if (session.startTime >= startOfDay) {
        console.log(`✅ Reactivating session ${sessionId}`);
        session.status = 'ACTIVE';
        session.endTime = undefined;
        await session.save();
      } else {
        return { status: 400, body: { message: 'Session is from previous day' } };
      }
    } else {
      return { status: 400, body: { message: 'Session is not active' } };
    }
  }

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
        pointCount: session.pointCount || 0,
      },
    };
  }

  // ✅ GPS jump filter
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
          pointCount: session.pointCount || 0,
        },
      };
    }
  }

  // ✅ Save location - FIXED: Handle duplicate key errors
  let location;
  try {
    location = await Location.create({
      userId,
      sessionId,
      latitude: lat,
      longitude: lng,
      timestamp: timestamp || new Date(),
      accuracy: accuracyNum || 0
    });
  } catch (err) {
    // ✅ If duplicate key error, it's likely a duplicate location
    if (err.code === 11000) {
      console.log(`📌 Duplicate location detected for session ${sessionId}, skipping save`);
      return {
        status: 200,
        body: {
          success: true,
          skipped: true,
          reason: 'duplicate_key',
          totalDistance: session.totalDistanceKm || 0,
          pointCount: session.pointCount || 0,
        },
      };
    }
    throw err;
  }

  // ✅ Calculate distance from previous location
  let distanceIncrement = 0;
  if (lastRoutePoint) {
    distanceIncrement = calculateDistance(
      lastRoutePoint.latitude,
      lastRoutePoint.longitude,
      lat,
      lng
    );
    if (distanceIncrement <= 0.0001) {
      distanceIncrement = 0;
    }
  }

  // ✅ Update session
  const updatedSession = await Session.findByIdAndUpdate(
    sessionId,
    {
      $inc: {
        totalDistanceKm: parseFloat(distanceIncrement.toFixed(6)),
        pointCount: 1,
      }
    },
    { new: true }
  );

  // ✅ Rebuild route periodically
  const shouldRebuild = updatedSession.pointCount % 5 === 0;
  let finalSession = updatedSession;

  if (shouldRebuild) {
    console.log(`🔄 Rebuilding route at ${updatedSession.pointCount} points`);
    const rebuilt = await rebuildSessionRoute(sessionId);
    if (rebuilt) {
      finalSession = rebuilt;
    }
  }

  const roundedTotal = parseFloat((finalSession.totalDistanceKm || 0).toFixed(4));
  if (roundedTotal !== finalSession.totalDistanceKm) {
    await Session.findByIdAndUpdate(sessionId, { totalDistanceKm: roundedTotal });
  }

  console.log(`✅ Location saved for session ${sessionId}: ${finalSession.pointCount} points, ${roundedTotal.toFixed(4)}km`);

  return {
    status: 200,
    body: {
      success: true,
      distance: distanceIncrement,
      totalDistance: roundedTotal,
      pointCount: finalSession.pointCount,
      location,
    },
  };
}

// ─── UPDATE LOCATION ENDPOINT ──────────────────────────────────────────
router.post("/update", async (req, res) => {
  try {
    const { userId, sessionId, latitude, longitude, timestamp, accuracy } = req.body;

    if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        message: "Missing required fields",
        required: ['userId', 'sessionId', 'latitude', 'longitude']
      });
    }

    console.log(`📍 GPS received session=${sessionId} lat=${latitude} lng=${longitude} acc=${accuracy}m`);

    const result = await runExclusive(sessionId, () =>
      processLocationPoint({ userId, sessionId, latitude, longitude, accuracy, timestamp: timestamp || new Date() })
    );

    // ✅ FIX: `success: true` is set on the response body for BOTH genuinely
    // saved points AND points the filters deliberately threw away
    // (duplicate / GPS-jump — see processLocationPoint's early returns,
    // which also set success:true so the client treats them as "handled
    // OK", not an error). Broadcasting on `success` alone meant every
    // submitted point — including ones that changed nothing in the DB —
    // got pushed to the live map with its raw coordinates, while
    // totalDistance/pointCount correctly stayed frozen. That's exactly
    // why the map line kept growing while "Today's Travel" stayed at
    // 0.00 KM / 1 pt: the line was drawing filtered-out points that were
    // never actually counted. Only broadcast points that were truly
    // persisted, so the line and the numbers always agree.
    if (result.status === 200 && result.body?.success && !result.body?.skipped) {
      broadcastAcceptedPoint(req, {
        userId,
        sessionId,
        latitude,
        longitude,
        timestamp: timestamp || new Date(),
        totalDistance: result.body.totalDistance || 0,
        pointCount: result.body.pointCount || 0,
      });
    }

    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('❌ Error updating location:', err);
    
    // ✅ Better error handling for duplicate keys
    if (err.code === 11000) {
      return res.status(200).json({
        success: true,
        skipped: true,
        reason: 'duplicate_key',
        message: 'Duplicate location (already exists)'
      });
    }
    
    res.status(500).json({ 
      message: "Error updating location", 
      error: err.message 
    });
  }
});

// ─── BATCH SYNC ENDPOINT ────────────────────────────────────────────────
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
      const { userId, sessionId, latitude, longitude, timestamp, accuracy } = point;

      if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
        results.push({ success: false, message: 'Missing required fields', point });
        continue;
      }

      try {
        const result = await runExclusive(sessionId, () =>
          processLocationPoint({ userId, sessionId, latitude, longitude, accuracy, timestamp: timestamp || new Date() })
        );

        if (result.body.success !== false) successCount++;
        results.push(result.body);
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
    res.status(500).json({ message: "Error syncing offline points", error: err.message });
  }
});

// ─── GET SESSION WITH ROUTE ─────────────────────────────────────────────
router.get("/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const rebuiltSession = await rebuildSessionRoute(sessionId);
    
    if (!rebuiltSession) {
      const session = await Session.findById(sessionId);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }
      return res.json({
        _id: session._id,
        userId: session.userId,
        startTime: session.startTime,
        endTime: session.endTime,
        startLocation: session.startLocation,
        route: session.route || [],
        totalDistanceKm: session.totalDistanceKm || 0,
        pointCount: session.pointCount || 0,
        status: session.status,
      });
    }

    res.json({
      _id: rebuiltSession._id,
      userId: rebuiltSession.userId,
      startTime: rebuiltSession.startTime,
      endTime: rebuiltSession.endTime,
      startLocation: rebuiltSession.startLocation,
      route: rebuiltSession.route || [],
      totalDistanceKm: rebuiltSession.totalDistanceKm || 0,
      pointCount: rebuiltSession.pointCount || 0,
      status: rebuiltSession.status,
    });
  } catch (err) {
    console.error('❌ Error fetching session:', err);
    res.status(500).json({ message: "Error fetching session", error: err.message });
  }
});

// ─── GET ALL LOCATIONS FOR SESSION ──────────────────────────────────────
router.get("/locations/:sessionId", async (req, res) => {
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
    res.status(500).json({ message: "Error fetching locations", error: err.message });
  }
});

// ─── DEBUG ENDPOINT ────────────────────────────────────────────────────
router.get("/debug/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const locations = await Location.find({ sessionId })
      .sort({ timestamp: 1 })
      .limit(10);
    
    const count = await Location.countDocuments({ sessionId });
    const session = await Session.findById(sessionId);
    
    res.json({
      session: {
        _id: session?._id,
        status: session?.status,
        pointCount: session?.pointCount || 0,
        totalDistanceKm: session?.totalDistanceKm || 0,
        routeLength: session?.route?.length || 0
      },
      locations: {
        total: count,
        sample: locations.map(l => ({
          lat: l.latitude,
          lng: l.longitude,
          timestamp: l.timestamp,
          accuracy: l.accuracy
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

//-------------------------------------------------------------------------------
// const express = require("express");
// const router = express.Router();
// const Location = require("../models/LocationModel/Location");
// const Session = require("../models/FSEModel/Session");
// const calculateDistance = require("../utils/distance");

// const MAX_ACCEPTABLE_ACCURACY_METERS = 150;
// const MAX_JUMP_METERS = 2000;
// const MAX_JUMP_WINDOW_MS = 10000;
// const MAX_PLAUSIBLE_SPEED_MPS = 100;
// const DUPLICATE_WINDOW_MS = 3000;
// const DUPLICATE_DISTANCE_METERS = 1;

// const kmToMeters = km => km * 1000;
// const { runExclusive } = require("../utils/sessionLock");

// // ── Route rebuild helper ──────────────────────────────────────────────
// async function rebuildSessionRoute(sessionId) {
//   try {
//     console.log(`🔄 Rebuilding route for session ${sessionId}`);
    
//     const locations = await Location.find({ sessionId })
//       .sort({ timestamp: 1 })
//       .lean();

//     if (locations.length === 0) {
//       console.log(`⚠️ No locations found for session ${sessionId}`);
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

//     // ✅ FIX: This function rebuilds the ENTIRE route from the Location
//     // collection (the real source of truth), so it must SET the route/
//     // totals directly — not $inc/$push, which was referencing undefined
//     // variables (distanceIncrement/lat/lng/timestamp) and threw a
//     // ReferenceError on every call, silently killing route persistence
//     // during active tracking (caught by the catch block below).
//     const updatedSession = await Session.findByIdAndUpdate(
//       sessionId,
//       {
//         route: route,
//         totalDistanceKm: parseFloat(totalDistance.toFixed(4)),
//         pointCount: locations.length,
//       },
//       { new: true }
//     );

//     console.log(`✅ Route rebuilt: ${locations.length} points, ${totalDistance.toFixed(4)}km`);
//     return updatedSession;
//   } catch (err) {
//     console.error(`❌ Failed to rebuild route for session ${sessionId}:`, err.message);
//     return null;
//   }
// }

// // ── Determine if a new point should be rejected as a GPS jump ────────
// function isImpossibleJump(prevPoint, latitude, longitude, timestamp) {
//   if (!prevPoint) return { reject: false };

//   const distanceKm = calculateDistance(
//     prevPoint.latitude, prevPoint.longitude,
//     latitude, longitude
//   );
//   const distanceMeters = kmToMeters(distanceKm);

//   const dtMs = new Date(timestamp) - new Date(prevPoint.timestamp);
//   const dtSeconds = dtMs / 1000;

//   if (dtSeconds <= 0) {
//     return { reject: false, distanceMeters, speedMps: null };
//   }

//   const speedMps = distanceMeters / dtSeconds;

//   if (distanceMeters > MAX_JUMP_METERS && dtMs <= MAX_JUMP_WINDOW_MS) {
//     return { reject: true, reason: 'GPS jump exceeds 2km within 10s', distanceMeters, speedMps };
//   }

//   if (speedMps > MAX_PLAUSIBLE_SPEED_MPS) {
//     return { reject: true, reason: 'Implausible speed', distanceMeters, speedMps };
//   }

//   return { reject: false, distanceMeters, speedMps };
// }

// // ── Determine if a point is a duplicate ─────────────────────────────────
// function isDuplicatePoint(prevPoint, latitude, longitude, timestamp) {
//   if (!prevPoint) return false;

//   const dtMs = Math.abs(new Date(timestamp) - new Date(prevPoint.timestamp));
//   if (dtMs > DUPLICATE_WINDOW_MS) return false;

//   const distanceKm = calculateDistance(
//     prevPoint.latitude, prevPoint.longitude,
//     latitude, longitude
//   );
//   const distanceMeters = kmToMeters(distanceKm);

//   return distanceMeters <= DUPLICATE_DISTANCE_METERS;
// }

// // // ─── BROADCAST HELPER ──────────────────────────────────────────────────
// // function broadcastAcceptedPoint(req, { sessionId, userId, latitude, longitude, timestamp, totalDistance, pointCount }) {
// //   if (!req.io) {
// //     console.warn('⚠️ req.io not available — skipping live broadcast');
// //     return false;
// //   }
  
// //   const payload = {
// //     sessionId,
// //     userId,
// //     latitude: parseFloat(latitude),
// //     longitude: parseFloat(longitude),
// //     timestamp: timestamp || new Date(),
// //     totalDistanceKm: parseFloat(totalDistance || 0),
// //     pointCount: parseInt(pointCount || 0),
// //     isCached: false,
// //   };
  
// //   try {
// //     req.io.to(`session-${sessionId}`).emit('session-location', payload);
// //     req.io.emit('users-location', payload);
// //     console.log(`📡 Socket broadcast sent session=${sessionId} pointCount=${pointCount} totalDistanceKm=${totalDistance}`);
// //     return true;
// //   } catch (emitErr) {
// //     console.log(`❌ Socket broadcast failed session=${sessionId}:`, emitErr.message);
// //     return false;
// //   }
// // }

// function broadcastAcceptedPoint(req, { sessionId, userId, latitude, longitude, timestamp, totalDistance, pointCount }) {
//   if (!req.io) return false;
//   const payload = {
//     sessionId: String(sessionId),
//     userId: String(userId),
//     latitude: parseFloat(latitude),
//     longitude: parseFloat(longitude),
//     timestamp: timestamp || new Date(),
//     totalDistanceKm: parseFloat(totalDistance || 0),
//     pointCount: parseInt(pointCount || 0),
//     isCached: false,
//   };
//   try {
//     req.io.to(`session-${sessionId}`).emit('session-location', payload);
//     req.io.emit('users-location', payload);
//     return true;
//   } catch (e) { return false; }
// }

// // ── Core point-processing logic ──────────────────────────────────────────
// async function processLocationPoint({ userId, sessionId, latitude, longitude, accuracy, timestamp }) {
//   if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
//     console.error('❌ Invalid location point data:', { userId, sessionId, latitude, longitude });
//     return { status: 400, body: { message: 'Missing required fields' } };
//   }

//   const lat = parseFloat(latitude);
//   const lng = parseFloat(longitude);
  
//   if (isNaN(lat) || isNaN(lng)) {
//     console.error('❌ Invalid coordinates:', { latitude, longitude });
//     return { status: 400, body: { message: 'Invalid coordinates' } };
//   }

//   if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
//     console.error('❌ Coordinates out of range:', { lat, lng });
//     return { status: 400, body: { message: 'Coordinates out of range' } };
//   }

//   const accuracyNum = parseFloat(accuracy);
//   if (accuracyNum > MAX_ACCEPTABLE_ACCURACY_METERS) {
//     console.log(`⚠️ Low GPS accuracy: ${accuracyNum}m (still accepting)`);
//   }

//   const session = await Session.findById(sessionId);
//   if (!session) {
//     console.error('❌ Session not found:', sessionId);
//     return { status: 404, body: { message: 'Session not found' } };
//   }

//   if (session.status !== 'ACTIVE') {
//     console.warn(`⚠️ Session ${sessionId} is not active (status: ${session.status})`);
    
//     if (session.status === 'AUTO_ENDED') {
//       console.log(`🔄 Attempting to reactivate AUTO_ENDED session ${sessionId}`);
//       const now = new Date();
//       const startOfDay = new Date();
//       startOfDay.setHours(0, 0, 0, 0);
      
//       if (session.startTime >= startOfDay) {
//         console.log(`✅ Reactivating session ${sessionId}`);
//         session.status = 'ACTIVE';
//         session.endTime = undefined;
//         await session.save();
//       } else {
//         return { status: 400, body: { message: 'Session is from previous day' } };
//       }
//     } else {
//       return { status: 400, body: { message: 'Session is not active' } };
//     }
//   }

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
//         pointCount: session.pointCount || 0,
//       },
//     };
//   }

//   // ✅ GPS jump filter
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
//           pointCount: session.pointCount || 0,
//         },
//       };
//     }
//   }

//   // ✅ Save location - FIXED: Handle duplicate key errors
//   let location;
//   try {
//     location = await Location.create({
//       userId,
//       sessionId,
//       latitude: lat,
//       longitude: lng,
//       timestamp: timestamp || new Date(),
//       accuracy: accuracyNum || 0
//     });
//   } catch (err) {
//     // ✅ If duplicate key error, it's likely a duplicate location
//     if (err.code === 11000) {
//       console.log(`📌 Duplicate location detected for session ${sessionId}, skipping save`);
//       return {
//         status: 200,
//         body: {
//           success: true,
//           skipped: true,
//           reason: 'duplicate_key',
//           totalDistance: session.totalDistanceKm || 0,
//           pointCount: session.pointCount || 0,
//         },
//       };
//     }
//     throw err;
//   }

//   // ✅ Calculate distance from previous location
//   let distanceIncrement = 0;
//   if (lastRoutePoint) {
//     distanceIncrement = calculateDistance(
//       lastRoutePoint.latitude,
//       lastRoutePoint.longitude,
//       lat,
//       lng
//     );
//     if (distanceIncrement <= 0.0001) {
//       distanceIncrement = 0;
//     }
//   }

//   // ✅ Update session
//   const updatedSession = await Session.findByIdAndUpdate(
//     sessionId,
//     {
//       $inc: {
//         totalDistanceKm: parseFloat(distanceIncrement.toFixed(6)),
//         pointCount: 1,
//       }
//     },
//     { new: true }
//   );

//   // ✅ Rebuild route periodically
//   const shouldRebuild = updatedSession.pointCount % 5 === 0;
//   let finalSession = updatedSession;

//   if (shouldRebuild) {
//     console.log(`🔄 Rebuilding route at ${updatedSession.pointCount} points`);
//     const rebuilt = await rebuildSessionRoute(sessionId);
//     if (rebuilt) {
//       finalSession = rebuilt;
//     }
//   }

//   const roundedTotal = parseFloat((finalSession.totalDistanceKm || 0).toFixed(4));
//   if (roundedTotal !== finalSession.totalDistanceKm) {
//     await Session.findByIdAndUpdate(sessionId, { totalDistanceKm: roundedTotal });
//   }

//   console.log(`✅ Location saved for session ${sessionId}: ${finalSession.pointCount} points, ${roundedTotal.toFixed(4)}km`);

//   return {
//     status: 200,
//     body: {
//       success: true,
//       distance: distanceIncrement,
//       totalDistance: roundedTotal,
//       pointCount: finalSession.pointCount,
//       location,
//     },
//   };
// }

// // ─── UPDATE LOCATION ENDPOINT ──────────────────────────────────────────
// router.post("/update", async (req, res) => {
//   try {
//     const { userId, sessionId, latitude, longitude, timestamp, accuracy } = req.body;

//     if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
//       return res.status(400).json({
//         message: "Missing required fields",
//         required: ['userId', 'sessionId', 'latitude', 'longitude']
//       });
//     }

//     console.log(`📍 GPS received session=${sessionId} lat=${latitude} lng=${longitude} acc=${accuracy}m`);

//     const result = await runExclusive(sessionId, () =>
//       processLocationPoint({ userId, sessionId, latitude, longitude, accuracy, timestamp: timestamp || new Date() })
//     );

//     if (result.status === 200 && result.body?.success) {
//       broadcastAcceptedPoint(req, {
//         userId,
//         sessionId,
//         latitude,
//         longitude,
//         timestamp: timestamp || new Date(),
//         totalDistance: result.body.totalDistance || 0,
//         pointCount: result.body.pointCount || 0,
//       });
//     }

//     return res.status(result.status).json(result.body);
//   } catch (err) {
//     console.error('❌ Error updating location:', err);
    
//     // ✅ Better error handling for duplicate keys
//     if (err.code === 11000) {
//       return res.status(200).json({
//         success: true,
//         skipped: true,
//         reason: 'duplicate_key',
//         message: 'Duplicate location (already exists)'
//       });
//     }
    
//     res.status(500).json({ 
//       message: "Error updating location", 
//       error: err.message 
//     });
//   }
// });

// // ─── BATCH SYNC ENDPOINT ────────────────────────────────────────────────
// router.post("/batch-sync", async (req, res) => {
//   try {
//     const { points } = req.body;
//     if (!Array.isArray(points) || points.length === 0) {
//       return res.status(400).json({ message: "points array is required" });
//     }

//     const sorted = [...points].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
//     console.log(`📦 Batch sync: ${sorted.length} points`);

//     const results = [];
//     let successCount = 0;

//     for (const point of sorted) {
//       const { userId, sessionId, latitude, longitude, timestamp, accuracy } = point;

//       if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
//         results.push({ success: false, message: 'Missing required fields', point });
//         continue;
//       }

//       try {
//         const result = await runExclusive(sessionId, () =>
//           processLocationPoint({ userId, sessionId, latitude, longitude, accuracy, timestamp: timestamp || new Date() })
//         );

//         if (result.body.success !== false) successCount++;
//         results.push(result.body);
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
//     res.status(500).json({ message: "Error syncing offline points", error: err.message });
//   }
// });

// // ─── GET SESSION WITH ROUTE ─────────────────────────────────────────────
// router.get("/session/:sessionId", async (req, res) => {
//   try {
//     const { sessionId } = req.params;
//     const rebuiltSession = await rebuildSessionRoute(sessionId);
    
//     if (!rebuiltSession) {
//       const session = await Session.findById(sessionId);
//       if (!session) {
//         return res.status(404).json({ message: "Session not found" });
//       }
//       return res.json({
//         _id: session._id,
//         userId: session.userId,
//         startTime: session.startTime,
//         endTime: session.endTime,
//         startLocation: session.startLocation,
//         route: session.route || [],
//         totalDistanceKm: session.totalDistanceKm || 0,
//         pointCount: session.pointCount || 0,
//         status: session.status,
//       });
//     }

//     res.json({
//       _id: rebuiltSession._id,
//       userId: rebuiltSession.userId,
//       startTime: rebuiltSession.startTime,
//       endTime: rebuiltSession.endTime,
//       startLocation: rebuiltSession.startLocation,
//       route: rebuiltSession.route || [],
//       totalDistanceKm: rebuiltSession.totalDistanceKm || 0,
//       pointCount: rebuiltSession.pointCount || 0,
//       status: rebuiltSession.status,
//     });
//   } catch (err) {
//     console.error('❌ Error fetching session:', err);
//     res.status(500).json({ message: "Error fetching session", error: err.message });
//   }
// });

// // ─── GET ALL LOCATIONS FOR SESSION ──────────────────────────────────────
// router.get("/locations/:sessionId", async (req, res) => {
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
//     res.status(500).json({ message: "Error fetching locations", error: err.message });
//   }
// });

// // ─── DEBUG ENDPOINT ────────────────────────────────────────────────────
// router.get("/debug/:sessionId", async (req, res) => {
//   try {
//     const { sessionId } = req.params;
    
//     const locations = await Location.find({ sessionId })
//       .sort({ timestamp: 1 })
//       .limit(10);
    
//     const count = await Location.countDocuments({ sessionId });
//     const session = await Session.findById(sessionId);
    
//     res.json({
//       session: {
//         _id: session?._id,
//         status: session?.status,
//         pointCount: session?.pointCount || 0,
//         totalDistanceKm: session?.totalDistanceKm || 0,
//         routeLength: session?.route?.length || 0
//       },
//       locations: {
//         total: count,
//         sample: locations.map(l => ({
//           lat: l.latitude,
//           lng: l.longitude,
//           timestamp: l.timestamp,
//           accuracy: l.accuracy
//         }))
//       }
//     });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// });

// module.exports = router;

// //------------- 28.8.26 --------------------
// // const express = require("express");
// // const router = express.Router();
// // const Location = require("../models/LocationModel/Location");
// // const Session = require("../models/FSEModel/Session");
// // const calculateDistance = require("../utils/distance");

// // const MAX_ACCEPTABLE_ACCURACY_METERS = 150;
// // const MAX_JUMP_METERS = 2000;
// // const MAX_JUMP_WINDOW_MS = 10000;
// // const MAX_PLAUSIBLE_SPEED_MPS = 100;
// // const DUPLICATE_WINDOW_MS = 3000;
// // const DUPLICATE_DISTANCE_METERS = 1;

// // const kmToMeters = km => km * 1000;
// // const { runExclusive } = require("../utils/sessionLock");

// // // ── Route rebuild helper ──────────────────────────────────────────────
// // async function rebuildSessionRoute(sessionId) {
// //   try {
// //     console.log(`🔄 Rebuilding route for session ${sessionId}`);
    
// //     const locations = await Location.find({ sessionId })
// //       .sort({ timestamp: 1 })
// //       .lean();

// //     if (locations.length === 0) {
// //       console.log(`⚠️ No locations found for session ${sessionId}`);
// //       return null;
// //     }

// //     let totalDistance = 0;
// //     for (let i = 1; i < locations.length; i++) {
// //       const prev = locations[i - 1];
// //       const curr = locations[i];
// //       totalDistance += calculateDistance(
// //         prev.latitude, prev.longitude,
// //         curr.latitude, curr.longitude
// //       );
// //     }

// //     const route = locations.map(l => ({
// //       latitude: l.latitude,
// //       longitude: l.longitude,
// //       timestamp: l.timestamp,
// //     }));

// //     // const updatedSession = await Session.findByIdAndUpdate(
// //     //   sessionId,
// //     //   {
// //     //     route: route,
// //     //     totalDistanceKm: parseFloat(totalDistance.toFixed(4)),
// //     //     pointCount: locations.length,
// //     //   },
// //     //   { new: true }
// //     // );

// //         // ✅ Update session
// //     const updatedSession = await Session.findByIdAndUpdate(
// //       sessionId,
// //       {
// //         $inc: {
// //           totalDistanceKm: parseFloat(distanceIncrement.toFixed(6)),
// //           pointCount: 1,
// //         },
// //         $push: {
// //           route: {
// //             latitude: lat,
// //             longitude: lng,
// //             timestamp: timestamp || new Date(),
// //           }
// //         }
// //       },
// //       { new: true }
// //     );

// //     console.log(`✅ Route rebuilt: ${locations.length} points, ${totalDistance.toFixed(4)}km`);
// //     return updatedSession;
// //   } catch (err) {
// //     console.error(`❌ Failed to rebuild route for session ${sessionId}:`, err.message);
// //     return null;
// //   }
// // }

// // // ── Determine if a new point should be rejected as a GPS jump ────────
// // function isImpossibleJump(prevPoint, latitude, longitude, timestamp) {
// //   if (!prevPoint) return { reject: false };

// //   const distanceKm = calculateDistance(
// //     prevPoint.latitude, prevPoint.longitude,
// //     latitude, longitude
// //   );
// //   const distanceMeters = kmToMeters(distanceKm);

// //   const dtMs = new Date(timestamp) - new Date(prevPoint.timestamp);
// //   const dtSeconds = dtMs / 1000;

// //   if (dtSeconds <= 0) {
// //     return { reject: false, distanceMeters, speedMps: null };
// //   }

// //   const speedMps = distanceMeters / dtSeconds;

// //   if (distanceMeters > MAX_JUMP_METERS && dtMs <= MAX_JUMP_WINDOW_MS) {
// //     return { reject: true, reason: 'GPS jump exceeds 2km within 10s', distanceMeters, speedMps };
// //   }

// //   if (speedMps > MAX_PLAUSIBLE_SPEED_MPS) {
// //     return { reject: true, reason: 'Implausible speed', distanceMeters, speedMps };
// //   }

// //   return { reject: false, distanceMeters, speedMps };
// // }

// // // ── Determine if a point is a duplicate ─────────────────────────────────
// // function isDuplicatePoint(prevPoint, latitude, longitude, timestamp) {
// //   if (!prevPoint) return false;

// //   const dtMs = Math.abs(new Date(timestamp) - new Date(prevPoint.timestamp));
// //   if (dtMs > DUPLICATE_WINDOW_MS) return false;

// //   const distanceKm = calculateDistance(
// //     prevPoint.latitude, prevPoint.longitude,
// //     latitude, longitude
// //   );
// //   const distanceMeters = kmToMeters(distanceKm);

// //   return distanceMeters <= DUPLICATE_DISTANCE_METERS;
// // }

// // // // ─── BROADCAST HELPER ──────────────────────────────────────────────────
// // // function broadcastAcceptedPoint(req, { sessionId, userId, latitude, longitude, timestamp, totalDistance, pointCount }) {
// // //   if (!req.io) {
// // //     console.warn('⚠️ req.io not available — skipping live broadcast');
// // //     return false;
// // //   }
  
// // //   const payload = {
// // //     sessionId,
// // //     userId,
// // //     latitude: parseFloat(latitude),
// // //     longitude: parseFloat(longitude),
// // //     timestamp: timestamp || new Date(),
// // //     totalDistanceKm: parseFloat(totalDistance || 0),
// // //     pointCount: parseInt(pointCount || 0),
// // //     isCached: false,
// // //   };
  
// // //   try {
// // //     req.io.to(`session-${sessionId}`).emit('session-location', payload);
// // //     req.io.emit('users-location', payload);
// // //     console.log(`📡 Socket broadcast sent session=${sessionId} pointCount=${pointCount} totalDistanceKm=${totalDistance}`);
// // //     return true;
// // //   } catch (emitErr) {
// // //     console.log(`❌ Socket broadcast failed session=${sessionId}:`, emitErr.message);
// // //     return false;
// // //   }
// // // }

// // function broadcastAcceptedPoint(req, { sessionId, userId, latitude, longitude, timestamp, totalDistance, pointCount }) {
// //   if (!req.io) return false;
// //   const payload = {
// //     sessionId: String(sessionId),
// //     userId: String(userId),
// //     latitude: parseFloat(latitude),
// //     longitude: parseFloat(longitude),
// //     timestamp: timestamp || new Date(),
// //     totalDistanceKm: parseFloat(totalDistance || 0),
// //     pointCount: parseInt(pointCount || 0),
// //     isCached: false,
// //   };
// //   try {
// //     req.io.to(`session-${sessionId}`).emit('session-location', payload);
// //     req.io.emit('users-location', payload);
// //     return true;
// //   } catch (e) { return false; }
// // }

// // // ── Core point-processing logic ──────────────────────────────────────────
// // async function processLocationPoint({ userId, sessionId, latitude, longitude, accuracy, timestamp }) {
// //   if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
// //     console.error('❌ Invalid location point data:', { userId, sessionId, latitude, longitude });
// //     return { status: 400, body: { message: 'Missing required fields' } };
// //   }

// //   const lat = parseFloat(latitude);
// //   const lng = parseFloat(longitude);
  
// //   if (isNaN(lat) || isNaN(lng)) {
// //     console.error('❌ Invalid coordinates:', { latitude, longitude });
// //     return { status: 400, body: { message: 'Invalid coordinates' } };
// //   }

// //   if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
// //     console.error('❌ Coordinates out of range:', { lat, lng });
// //     return { status: 400, body: { message: 'Coordinates out of range' } };
// //   }

// //   const accuracyNum = parseFloat(accuracy);
// //   if (accuracyNum > MAX_ACCEPTABLE_ACCURACY_METERS) {
// //     console.log(`⚠️ Low GPS accuracy: ${accuracyNum}m (still accepting)`);
// //   }

// //   const session = await Session.findById(sessionId);
// //   if (!session) {
// //     console.error('❌ Session not found:', sessionId);
// //     return { status: 404, body: { message: 'Session not found' } };
// //   }

// //   if (session.status !== 'ACTIVE') {
// //     console.warn(`⚠️ Session ${sessionId} is not active (status: ${session.status})`);
    
// //     if (session.status === 'AUTO_ENDED') {
// //       console.log(`🔄 Attempting to reactivate AUTO_ENDED session ${sessionId}`);
// //       const now = new Date();
// //       const startOfDay = new Date();
// //       startOfDay.setHours(0, 0, 0, 0);
      
// //       if (session.startTime >= startOfDay) {
// //         console.log(`✅ Reactivating session ${sessionId}`);
// //         session.status = 'ACTIVE';
// //         session.endTime = undefined;
// //         await session.save();
// //       } else {
// //         return { status: 400, body: { message: 'Session is from previous day' } };
// //       }
// //     } else {
// //       return { status: 400, body: { message: 'Session is not active' } };
// //     }
// //   }

// //   const lastRoutePoint = session.route.length > 0
// //     ? session.route[session.route.length - 1]
// //     : session.startLocation
// //       ? { latitude: session.startLocation.latitude, longitude: session.startLocation.longitude, timestamp: session.startTime }
// //       : null;

// //   // ✅ Deduplication check
// //   if (lastRoutePoint && isDuplicatePoint(lastRoutePoint, lat, lng, timestamp)) {
// //     console.log(`📌 Duplicate point skipped for session ${sessionId}`);
// //     return {
// //       status: 200,
// //       body: {
// //         success: true,
// //         skipped: true,
// //         reason: 'duplicate',
// //         totalDistance: session.totalDistanceKm || 0,
// //         pointCount: session.pointCount || 0,
// //       },
// //     };
// //   }

// //   // ✅ GPS jump filter
// //   if (lastRoutePoint) {
// //     const jumpCheck = isImpossibleJump(lastRoutePoint, lat, lng, timestamp);
// //     if (jumpCheck.reject) {
// //       console.log(`⚠️ Rejected GPS point for session ${sessionId}: ${jumpCheck.reason}`);
// //       return {
// //         status: 200,
// //         body: {
// //           success: true,
// //           skipped: true,
// //           reason: jumpCheck.reason,
// //           totalDistance: session.totalDistanceKm || 0,
// //           pointCount: session.pointCount || 0,
// //         },
// //       };
// //     }
// //   }

// //   // ✅ Save location - FIXED: Handle duplicate key errors
// //   let location;
// //   try {
// //     location = await Location.create({
// //       userId,
// //       sessionId,
// //       latitude: lat,
// //       longitude: lng,
// //       timestamp: timestamp || new Date(),
// //       accuracy: accuracyNum || 0
// //     });
// //   } catch (err) {
// //     // ✅ If duplicate key error, it's likely a duplicate location
// //     if (err.code === 11000) {
// //       console.log(`📌 Duplicate location detected for session ${sessionId}, skipping save`);
// //       return {
// //         status: 200,
// //         body: {
// //           success: true,
// //           skipped: true,
// //           reason: 'duplicate_key',
// //           totalDistance: session.totalDistanceKm || 0,
// //           pointCount: session.pointCount || 0,
// //         },
// //       };
// //     }
// //     throw err;
// //   }

// //   // ✅ Calculate distance from previous location
// //   let distanceIncrement = 0;
// //   if (lastRoutePoint) {
// //     distanceIncrement = calculateDistance(
// //       lastRoutePoint.latitude,
// //       lastRoutePoint.longitude,
// //       lat,
// //       lng
// //     );
// //     if (distanceIncrement <= 0.0001) {
// //       distanceIncrement = 0;
// //     }
// //   }

// //   // ✅ Update session
// //   const updatedSession = await Session.findByIdAndUpdate(
// //     sessionId,
// //     {
// //       $inc: {
// //         totalDistanceKm: parseFloat(distanceIncrement.toFixed(6)),
// //         pointCount: 1,
// //       }
// //     },
// //     { new: true }
// //   );

// //   // ✅ Rebuild route periodically
// //   const shouldRebuild = updatedSession.pointCount % 5 === 0;
// //   let finalSession = updatedSession;

// //   if (shouldRebuild) {
// //     console.log(`🔄 Rebuilding route at ${updatedSession.pointCount} points`);
// //     const rebuilt = await rebuildSessionRoute(sessionId);
// //     if (rebuilt) {
// //       finalSession = rebuilt;
// //     }
// //   }

// //   const roundedTotal = parseFloat((finalSession.totalDistanceKm || 0).toFixed(4));
// //   if (roundedTotal !== finalSession.totalDistanceKm) {
// //     await Session.findByIdAndUpdate(sessionId, { totalDistanceKm: roundedTotal });
// //   }

// //   console.log(`✅ Location saved for session ${sessionId}: ${finalSession.pointCount} points, ${roundedTotal.toFixed(4)}km`);

// //   return {
// //     status: 200,
// //     body: {
// //       success: true,
// //       distance: distanceIncrement,
// //       totalDistance: roundedTotal,
// //       pointCount: finalSession.pointCount,
// //       location,
// //     },
// //   };
// // }

// // // ─── UPDATE LOCATION ENDPOINT ──────────────────────────────────────────
// // router.post("/update", async (req, res) => {
// //   try {
// //     const { userId, sessionId, latitude, longitude, timestamp, accuracy } = req.body;

// //     if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
// //       return res.status(400).json({
// //         message: "Missing required fields",
// //         required: ['userId', 'sessionId', 'latitude', 'longitude']
// //       });
// //     }

// //     console.log(`📍 GPS received session=${sessionId} lat=${latitude} lng=${longitude} acc=${accuracy}m`);

// //     const result = await runExclusive(sessionId, () =>
// //       processLocationPoint({ userId, sessionId, latitude, longitude, accuracy, timestamp: timestamp || new Date() })
// //     );

// //     if (result.status === 200 && result.body?.success) {
// //       broadcastAcceptedPoint(req, {
// //         userId,
// //         sessionId,
// //         latitude,
// //         longitude,
// //         timestamp: timestamp || new Date(),
// //         totalDistance: result.body.totalDistance || 0,
// //         pointCount: result.body.pointCount || 0,
// //       });
// //     }

// //     return res.status(result.status).json(result.body);
// //   } catch (err) {
// //     console.error('❌ Error updating location:', err);
    
// //     // ✅ Better error handling for duplicate keys
// //     if (err.code === 11000) {
// //       return res.status(200).json({
// //         success: true,
// //         skipped: true,
// //         reason: 'duplicate_key',
// //         message: 'Duplicate location (already exists)'
// //       });
// //     }
    
// //     res.status(500).json({ 
// //       message: "Error updating location", 
// //       error: err.message 
// //     });
// //   }
// // });

// // // ─── BATCH SYNC ENDPOINT ────────────────────────────────────────────────
// // router.post("/batch-sync", async (req, res) => {
// //   try {
// //     const { points } = req.body;
// //     if (!Array.isArray(points) || points.length === 0) {
// //       return res.status(400).json({ message: "points array is required" });
// //     }

// //     const sorted = [...points].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
// //     console.log(`📦 Batch sync: ${sorted.length} points`);

// //     const results = [];
// //     let successCount = 0;

// //     for (const point of sorted) {
// //       const { userId, sessionId, latitude, longitude, timestamp, accuracy } = point;

// //       if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
// //         results.push({ success: false, message: 'Missing required fields', point });
// //         continue;
// //       }

// //       try {
// //         const result = await runExclusive(sessionId, () =>
// //           processLocationPoint({ userId, sessionId, latitude, longitude, accuracy, timestamp: timestamp || new Date() })
// //         );

// //         if (result.body.success !== false) successCount++;
// //         results.push(result.body);
// //       } catch (pointErr) {
// //         console.error('❌ Error processing batched point:', pointErr.message);
// //         results.push({ success: false, message: pointErr.message, point });
// //       }
// //     }

// //     console.log(`✅ Batch sync complete: ${successCount}/${sorted.length} points processed`);

// //     res.json({
// //       success: true,
// //       processed: results.length,
// //       successful: successCount,
// //       results
// //     });
// //   } catch (err) {
// //     console.error('❌ Error in batch-sync:', err);
// //     res.status(500).json({ message: "Error syncing offline points", error: err.message });
// //   }
// // });

// // // ─── GET SESSION WITH ROUTE ─────────────────────────────────────────────
// // router.get("/session/:sessionId", async (req, res) => {
// //   try {
// //     const { sessionId } = req.params;
// //     const rebuiltSession = await rebuildSessionRoute(sessionId);
    
// //     if (!rebuiltSession) {
// //       const session = await Session.findById(sessionId);
// //       if (!session) {
// //         return res.status(404).json({ message: "Session not found" });
// //       }
// //       return res.json({
// //         _id: session._id,
// //         userId: session.userId,
// //         startTime: session.startTime,
// //         endTime: session.endTime,
// //         startLocation: session.startLocation,
// //         route: session.route || [],
// //         totalDistanceKm: session.totalDistanceKm || 0,
// //         pointCount: session.pointCount || 0,
// //         status: session.status,
// //       });
// //     }

// //     res.json({
// //       _id: rebuiltSession._id,
// //       userId: rebuiltSession.userId,
// //       startTime: rebuiltSession.startTime,
// //       endTime: rebuiltSession.endTime,
// //       startLocation: rebuiltSession.startLocation,
// //       route: rebuiltSession.route || [],
// //       totalDistanceKm: rebuiltSession.totalDistanceKm || 0,
// //       pointCount: rebuiltSession.pointCount || 0,
// //       status: rebuiltSession.status,
// //     });
// //   } catch (err) {
// //     console.error('❌ Error fetching session:', err);
// //     res.status(500).json({ message: "Error fetching session", error: err.message });
// //   }
// // });

// // // ─── GET ALL LOCATIONS FOR SESSION ──────────────────────────────────────
// // router.get("/locations/:sessionId", async (req, res) => {
// //   try {
// //     const { sessionId } = req.params;
// //     const page = parseInt(req.query.page, 10) || 1;
// //     const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
// //     const skip = (page - 1) * limit;

// //     const [locations, total] = await Promise.all([
// //       Location.find({ sessionId })
// //         .sort({ timestamp: 1 })
// //         .skip(skip)
// //         .limit(limit),
// //       Location.countDocuments({ sessionId }),
// //     ]);

// //     res.json({
// //       locations,
// //       pagination: {
// //         page,
// //         limit,
// //         total,
// //         totalPages: Math.ceil(total / limit),
// //       },
// //     });
// //   } catch (err) {
// //     console.error('❌ Error fetching locations:', err);
// //     res.status(500).json({ message: "Error fetching locations", error: err.message });
// //   }
// // });

// // // ─── DEBUG ENDPOINT ────────────────────────────────────────────────────
// // router.get("/debug/:sessionId", async (req, res) => {
// //   try {
// //     const { sessionId } = req.params;
    
// //     const locations = await Location.find({ sessionId })
// //       .sort({ timestamp: 1 })
// //       .limit(10);
    
// //     const count = await Location.countDocuments({ sessionId });
// //     const session = await Session.findById(sessionId);
    
// //     res.json({
// //       session: {
// //         _id: session?._id,
// //         status: session?.status,
// //         pointCount: session?.pointCount || 0,
// //         totalDistanceKm: session?.totalDistanceKm || 0,
// //         routeLength: session?.route?.length || 0
// //       },
// //       locations: {
// //         total: count,
// //         sample: locations.map(l => ({
// //           lat: l.latitude,
// //           lng: l.longitude,
// //           timestamp: l.timestamp,
// //           accuracy: l.accuracy
// //         }))
// //       }
// //     });
// //   } catch (err) {
// //     res.status(500).json({ message: err.message });
// //   }
// // });

// // module.exports = router;
