
/**
 * locationRoutes.js
 *
 * Endpoints
 * ─────────
 *  POST /api/location/update          — single GPS point from device
 *  POST /api/location/batch-sync      — flush offline queue (array of points)
 *  GET  /api/location/session/:id     — rebuild + return session with route
 *  GET  /api/location/locations/:id   — paginated raw Location documents
 *  GET  /api/location/debug/:id       — diagnostic snapshot
 */

'use strict';

const express           = require('express');
const router            = express.Router();
const Location          = require('../models/LocationModel/Location');
const Session           = require('../models/FSEModel/Session');
const calculateDistance = require('../utils/distance');
const { runExclusive }  = require('../utils/sessionLock');

// ─── Tuning constants ────────────────────────────────────────────────────────
const MAX_ACCURACY_M       = 150;   // warn but still accept
const MAX_JUMP_M           = 2000;  // hard reject if this far in …
const MAX_JUMP_WINDOW_MS   = 10000; // … this time window
const MAX_SPEED_MPS        = 100;   // ~360 km/h — reject above this
const DEDUP_WINDOW_MS      = 3000;
const DEDUP_DISTANCE_M     = 1;
// Rebuild the session.route snapshot from Location collection every N points
const REBUILD_EVERY_N      = 10;

// ─── Utils ───────────────────────────────────────────────────────────────────
const kmToM = km => km * 1000;

function isImpossibleJump(prev, lat, lng, ts) {
  if (!prev) return { reject: false };
  const distM  = kmToM(calculateDistance(prev.latitude, prev.longitude, lat, lng));
  const dtMs   = new Date(ts) - new Date(prev.timestamp);
  const dtSec  = dtMs / 1000;
  if (dtSec <= 0) return { reject: false };
  const speedMps = distM / dtSec;
  if (distM > MAX_JUMP_M && dtMs <= MAX_JUMP_WINDOW_MS)
    return { reject: true, reason: `GPS jump ${distM.toFixed(0)}m in ${dtMs}ms` };
  if (speedMps > MAX_SPEED_MPS)
    return { reject: true, reason: `Implausible speed ${speedMps.toFixed(1)} m/s` };
  return { reject: false };
}

function isDuplicate(prev, lat, lng, ts) {
  if (!prev) return false;
  const dtMs  = Math.abs(new Date(ts) - new Date(prev.timestamp));
  if (dtMs > DEDUP_WINDOW_MS) return false;
  const distM = kmToM(calculateDistance(prev.latitude, prev.longitude, lat, lng));
  return distM <= DEDUP_DISTANCE_M;
}

// ─── Socket broadcast ────────────────────────────────────────────────────────
function broadcast(req, payload) {
  if (!req.io) return;
  try {
    req.io.to(`session-${payload.sessionId}`).emit('session-location', payload);
    req.io.emit('users-location', payload);
  } catch (e) {
    console.warn('[locationRoutes] broadcast error:', e.message);
  }
}

// ─── Route snapshot rebuild ───────────────────────────────────────────────────
async function rebuildSessionRoute(sessionId) {
  const locs = await Location.find({ sessionId })
    .sort({ timestamp: 1 })
    .lean();

  if (!locs.length) return null;

  let totalDist = 0;
  for (let i = 1; i < locs.length; i++) {
    totalDist += calculateDistance(
      locs[i - 1].latitude, locs[i - 1].longitude,
      locs[i].latitude,     locs[i].longitude,
    );
  }

  const route = locs.map(l => ({
    latitude:  l.latitude,
    longitude: l.longitude,
    timestamp: l.timestamp,
  }));

  return Session.findByIdAndUpdate(
    sessionId,
    {
      route:           route,
      totalDistanceKm: parseFloat(totalDist.toFixed(4)),
      pointCount:      locs.length,
    },
    { new: true },
  );
}

// ─── Core point processor ────────────────────────────────────────────────────
async function processPoint({ userId, sessionId, latitude, longitude, accuracy, timestamp }) {
  // Validate
  if (!userId || !sessionId || latitude == null || longitude == null)
    return { status: 400, body: { message: 'Missing required fields' } };

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  const acc = parseFloat(accuracy) || 0;
  const ts  = timestamp ? new Date(timestamp) : new Date();

  if (isNaN(lat) || isNaN(lng))
    return { status: 400, body: { message: 'Invalid coordinates' } };

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180)
    return { status: 400, body: { message: 'Coordinates out of range' } };

  if (acc > MAX_ACCURACY_M)
    console.log(`[locationRoutes] ⚠️  Low accuracy ${acc}m — accepting anyway`);

  // Load session
  const session = await Session.findById(sessionId);
  if (!session)
    return { status: 404, body: { message: 'Session not found' } };

  // Allow AUTO_ENDED sessions to resume within the same calendar day
  if (session.status !== 'ACTIVE') {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    if (session.status === 'AUTO_ENDED' && session.startTime >= startOfDay) {
      session.status  = 'ACTIVE';
      session.endTime = undefined;
      await session.save();
    } else {
      return { status: 400, body: { message: `Session is ${session.status}` } };
    }
  }

  // Last point for dedup / jump / distance
  const lastPt = session.route.length > 0
    ? session.route[session.route.length - 1]
    : session.startLocation
      ? { ...session.startLocation, timestamp: session.startTime }
      : null;

  if (lastPt && isDuplicate(lastPt, lat, lng, ts))
    return {
      status: 200,
      body:   { success: true, skipped: true, reason: 'duplicate',
                totalDistance: session.totalDistanceKm, pointCount: session.pointCount },
    };

  if (lastPt) {
    const jump = isImpossibleJump(lastPt, lat, lng, ts);
    if (jump.reject) {
      console.log(`[locationRoutes] ⚠️  Rejected: ${jump.reason}`);
      return {
        status: 200,
        body:   { success: true, skipped: true, reason: jump.reason,
                  totalDistance: session.totalDistanceKm, pointCount: session.pointCount },
      };
    }
  }

  // Persist the Location document
  let location;
  try {
    location = await Location.create({ userId, sessionId, latitude: lat, longitude: lng, accuracy: acc, timestamp: ts });
  } catch (err) {
    if (err.code === 11000)  // duplicate key
      return { status: 200, body: { success: true, skipped: true, reason: 'duplicate_key',
                                    totalDistance: session.totalDistanceKm, pointCount: session.pointCount } };
    throw err;
  }

  // Distance increment
  let increment = 0;
  if (lastPt) {
    const d = calculateDistance(lastPt.latitude, lastPt.longitude, lat, lng);
    if (d > 0.0001) increment = d;
  }

  // Atomic update on the Session document
  const updated = await Session.findByIdAndUpdate(
    sessionId,
    { $inc: { totalDistanceKm: parseFloat(increment.toFixed(6)), pointCount: 1 } },
    { new: true },
  );

  // Periodic rebuild to keep session.route in sync
  let final = updated;
  if (updated.pointCount % REBUILD_EVERY_N === 0) {
    const rebuilt = await rebuildSessionRoute(sessionId);
    if (rebuilt) final = rebuilt;
  }

  const totalDist = parseFloat((final.totalDistanceKm || 0).toFixed(4));

  console.log(
    `[locationRoutes] ✅  session=${sessionId} pts=${final.pointCount} dist=${totalDist}km`,
  );

  return {
    status: 200,
    body: {
      success:       true,
      distance:      increment,
      totalDistance: totalDist,
      pointCount:    final.pointCount,
      location,
    },
  };
}

// ─── POST /update ─────────────────────────────────────────────────────────────
router.post('/update', async (req, res) => {
  const { userId, sessionId, latitude, longitude, accuracy, timestamp } = req.body;

  if (!userId || !sessionId || latitude == null || longitude == null) {
    return res.status(400).json({
      message:  'Missing required fields',
      required: ['userId', 'sessionId', 'latitude', 'longitude'],
    });
  }

  console.log(
    `[locationRoutes] 📍 GPS in: session=${sessionId} lat=${latitude} lng=${longitude} acc=${accuracy}m`,
  );

  try {
    const result = await runExclusive(sessionId, () =>
      processPoint({ userId, sessionId, latitude, longitude, accuracy, timestamp }),
    );

    if (result.status === 200 && result.body.success) {
      broadcast(req, {
        sessionId,
        userId,
        latitude:       parseFloat(latitude),
        longitude:      parseFloat(longitude),
        timestamp:      timestamp || new Date(),
        totalDistanceKm: result.body.totalDistance || 0,
        pointCount:     result.body.pointCount     || 0,
        isCached:       false,
      });
    }

    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[locationRoutes] /update error:', err.message);
    if (err.code === 11000)
      return res.status(200).json({ success: true, skipped: true, reason: 'duplicate_key' });
    return res.status(500).json({ message: 'Error updating location', error: err.message });
  }
});

// ─── POST /batch-sync ─────────────────────────────────────────────────────────
router.post('/batch-sync', async (req, res) => {
  const { points } = req.body;
  if (!Array.isArray(points) || !points.length)
    return res.status(400).json({ message: 'points array is required' });

  // Process in chronological order
  const sorted = [...points].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  console.log(`[locationRoutes] 📦 Batch-sync: ${sorted.length} points`);

  let successCount = 0;
  const results    = [];

  for (const pt of sorted) {
    const { userId, sessionId, latitude, longitude, accuracy, timestamp } = pt;
    if (!userId || !sessionId || latitude == null || longitude == null) {
      results.push({ success: false, message: 'Missing fields', point: pt });
      continue;
    }
    try {
      const result = await runExclusive(sessionId, () =>
        processPoint({ userId, sessionId, latitude, longitude, accuracy, timestamp }),
      );
      if (result.body.success !== false) {
        successCount++;
        // broadcast each accepted offline point so the admin map catches up
        broadcast(req, {
          sessionId, userId,
          latitude:       parseFloat(latitude),
          longitude:      parseFloat(longitude),
          timestamp:      timestamp || new Date(),
          totalDistanceKm: result.body.totalDistance || 0,
          pointCount:     result.body.pointCount     || 0,
          isCached:       true,
        });
      }
      results.push(result.body);
    } catch (err) {
      results.push({ success: false, message: err.message });
    }
  }

  console.log(`[locationRoutes] ✅  Batch done: ${successCount}/${sorted.length} accepted`);
  return res.json({
    success:    true,
    processed:  results.length,
    successful: successCount,
    results,
  });
});

// ─── GET /session/:sessionId ──────────────────────────────────────────────────
// Returns a fully rebuilt session (route array rebuilt from Location docs).
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const rebuilt = await rebuildSessionRoute(sessionId);

    if (!rebuilt) {
      const session = await Session.findById(sessionId);
      if (!session) return res.status(404).json({ message: 'Session not found' });
      return res.json({
        _id:             session._id,
        userId:          session.userId,
        startTime:       session.startTime,
        endTime:         session.endTime,
        startLocation:   session.startLocation,
        route:           session.route || [],
        totalDistanceKm: session.totalDistanceKm || 0,
        pointCount:      session.pointCount       || 0,
        status:          session.status,
      });
    }

    return res.json({
      _id:             rebuilt._id,
      userId:          rebuilt.userId,
      startTime:       rebuilt.startTime,
      endTime:         rebuilt.endTime,
      startLocation:   rebuilt.startLocation,
      route:           rebuilt.route || [],
      totalDistanceKm: rebuilt.totalDistanceKm || 0,
      pointCount:      rebuilt.pointCount       || 0,
      status:          rebuilt.status,
    });
  } catch (err) {
    console.error('[locationRoutes] /session GET error:', err.message);
    return res.status(500).json({ message: 'Error fetching session', error: err.message });
  }
});

// ─── GET /locations/:sessionId ───────────────────────────────────────────────
// Paginated raw Location documents for this session.
router.get('/locations/:sessionId', async (req, res) => {
  try {
    const { sessionId }   = req.params;
    const page  = parseInt(req.query.page,  10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
    const skip  = (page - 1) * limit;

    const [locations, total] = await Promise.all([
      Location.find({ sessionId }).sort({ timestamp: 1 }).skip(skip).limit(limit).lean(),
      Location.countDocuments({ sessionId }),
    ]);

    return res.json({
      locations,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[locationRoutes] /locations GET error:', err.message);
    return res.status(500).json({ message: 'Error fetching locations', error: err.message });
  }
});

// ─── GET /debug/:sessionId ────────────────────────────────────────────────────
router.get('/debug/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const [count, session, sample] = await Promise.all([
      Location.countDocuments({ sessionId }),
      Session.findById(sessionId).lean(),
      Location.find({ sessionId }).sort({ timestamp: 1 }).limit(10).lean(),
    ]);
    return res.json({
      session: {
        _id:             session?._id,
        status:          session?.status,
        pointCount:      session?.pointCount      || 0,
        totalDistanceKm: session?.totalDistanceKm || 0,
        routeLength:     session?.route?.length   || 0,
      },
      locations: {
        total:  count,
        sample: sample.map(l => ({
          lat:       l.latitude,
          lng:       l.longitude,
          accuracy:  l.accuracy,
          timestamp: l.timestamp,
        })),
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;

//================ 19.08.2026 ============================
// // locationRoutes.js - COMPLETE FIXED VERSION

// const express = require("express");
// const router = express.Router();
// const Location = require("../models/LocationModel/Location");
// const Session = require("../models/FSEModel/Session");
// const calculateDistance = require("../utils/distance");

// // ✅ FIX: Increased thresholds for better GPS acceptance
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

//   // ✅ FIX: Only reject extreme jumps
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

// // ── Core point-processing logic ──────────────────────────────────────────
// async function processLocationPoint({ userId, sessionId, latitude, longitude, accuracy, timestamp }) {
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

//   if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
//     console.error('❌ Coordinates out of range:', { lat, lng });
//     return { status: 400, body: { message: 'Coordinates out of range' } };
//   }

//   // ✅ Validate accuracy - warn but don't reject
//   const accuracyNum = parseFloat(accuracy);
//   if (accuracyNum > MAX_ACCEPTABLE_ACCURACY_METERS) {
//     console.log(`⚠️ Low GPS accuracy: ${accuracyNum}m (still accepting)`);
//   }

//   const session = await Session.findById(sessionId);
//   if (!session) {
//     console.error('❌ Session not found:', sessionId);
//     return { status: 404, body: { message: 'Session not found' } };
//   }

//   // ✅ FIX: Check session status
//   if (session.status !== 'ACTIVE') {
//     console.warn(`⚠️ Session ${sessionId} is not active (status: ${session.status})`);
    
//     // ✅ If session is AUTO_ENDED, try to reactivate
//     if (session.status === 'AUTO_ENDED') {
//       console.log(`🔄 Attempting to reactivate AUTO_ENDED session ${sessionId}`);
//       const now = new Date();
//       const startOfDay = new Date();
//       startOfDay.setHours(0, 0, 0, 0);
      
//       // ✅ Only reactivate if it's still the same day
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
//       lng
//     );
//     if (distanceIncrement <= 0.0001) {
//       distanceIncrement = 0;
//     }
//   }

//   // ✅ Update session - increment distance and pointCount
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

//   // ✅ Rebuild route periodically (every 5 points)
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

//     // ✅ ALWAYS broadcast if successful (even if skipped)
//     if (result.status === 200 && result.body?.success) {
//       const broadcastSent = broadcastAcceptedPoint(req, {
//         userId,
//         sessionId,
//         latitude,
//         longitude,
//         timestamp: timestamp || new Date(),
//         totalDistance: result.body.totalDistance || 0,
//         pointCount: result.body.pointCount || 0,
//       });
      
//       if (broadcastSent) {
//         console.log(`✅ Broadcast sent for session ${sessionId}`);
//       }
//     }

//     return res.status(result.status).json(result.body);
//   } catch (err) {
//     console.error('❌ Error updating location:', err);
//     res.status(500).json({ message: "Error updating location", error: err.message });
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

//         // ✅ Broadcast for batch points too
//         if (result.status === 200 && result.body?.success) {
//           broadcastAcceptedPoint(req, {
//             userId,
//             sessionId,
//             latitude,
//             longitude,
//             timestamp: timestamp || new Date(),
//             totalDistance: result.body.totalDistance || 0,
//             pointCount: result.body.pointCount || 0,
//           });
//         }

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

//     // ✅ ALWAYS rebuild route from Location collection
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

// // ✅ DEBUG ENDPOINT - Check location collection
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
//           timestamp: l.timestamp
//         }))
//       }
//     });
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// });

// module.exports = router;