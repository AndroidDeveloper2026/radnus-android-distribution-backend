// locationRoutes.js - COMPLETE FILE

const router = require('express').Router();
const Location = require('../models/FSEModel/Location');
const Session = require('../models/FSEModel/Session');

// ============================================
// HELPER FUNCTIONS
// ============================================

// Calculate distance using Haversine formula (returns km)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  // ✅ Input validation
  if (
    lat1 == null || lon1 == null ||
    lat2 == null || lon2 == null ||
    isNaN(lat1) || isNaN(lon1) ||
    isNaN(lat2) || isNaN(lon2)
  ) {
    console.warn('calculateDistance: invalid coordinates', { lat1, lon1, lat2, lon2 });
    return 0;
  }

  const R = 6371; // Earth's radius in km
  const toRad = (deg) => deg * Math.PI / 180;
  
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
};

// ============================================
// UPDATE LOCATION
// ============================================

/**
 * POST /api/location/update
 * Body: { userId, sessionId, latitude, longitude, timestamp, accuracy }
 * Saves a GPS point and updates the session route
 */
router.post('/update', async (req, res) => {
  try {
    const { userId, sessionId, latitude, longitude, timestamp, accuracy } = req.body;

    // ✅ Validate required fields
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    if (!sessionId) {
      return res.status(400).json({ message: 'sessionId is required' });
    }

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: 'latitude and longitude are required' });
    }

    // ✅ Validate coordinates
    if (latitude < -90 || latitude > 90) {
      return res.status(400).json({ message: 'Invalid latitude: must be between -90 and 90' });
    }

    if (longitude < -180 || longitude > 180) {
      return res.status(400).json({ message: 'Invalid longitude: must be between -180 and 180' });
    }

    // ✅ Validate session exists and is active
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    if (session.status !== 'ACTIVE') {
      return res.status(400).json({ 
        message: `Session is not active (status: ${session.status})` 
      });
    }

    // ✅ Validate user matches session
    if (session.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'User does not match session' });
    }

    // ✅ Create location record
    const location = new Location({
      userId: userId,
      sessionId: sessionId,
      latitude: latitude,
      longitude: longitude,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      // Store accuracy if provided
      accuracy: accuracy || null
    });

    await location.save();

    // ✅ Update session route and distance
    const lastPoint = session.route.length > 0 
      ? session.route[session.route.length - 1] 
      : null;

    // Add to route
    session.route.push({
      latitude: latitude,
      longitude: longitude,
      timestamp: new Date()
    });

    // ✅ Calculate distance from last point
    if (lastPoint) {
      const distance = calculateDistance(
        lastPoint.latitude, lastPoint.longitude,
        latitude, longitude
      );
      
      // Only add if distance is reasonable (less than 1km to avoid GPS glitches)
      if (distance < 1) {
        session.totalDistanceKm += distance;
        console.log(`📊 Distance added: ${distance.toFixed(4)} km`);
      } else {
        console.warn(`⚠️ Skipping large distance jump: ${distance.toFixed(2)} km`);
      }
    }

    // ✅ Trim route if it gets too large (max 10,000 points)
    if (session.route.length > 10000) {
      const trimmedRoute = session.route.slice(-5000);
      session.route = trimmedRoute;
      console.log(`✂️ Route trimmed to 5000 points (was ${session.route.length})`);
    }

    await session.save();

    console.log(`✅ Location saved: ${sessionId} - ${latitude}, ${longitude}`);

    res.json({
      success: true,
      message: 'Location updated successfully',
      location: {
        _id: location._id,
        sessionId: sessionId,
        latitude: latitude,
        longitude: longitude,
        timestamp: location.timestamp
      },
      session: {
        totalDistanceKm: session.totalDistanceKm,
        routeCount: session.route.length
      }
    });

  } catch (err) {
    console.error('❌ Error updating location:', err);
    res.status(500).json({
      success: false,
      message: 'Error updating location',
      error: err.message
    });
  }
});

// ============================================
// BULK UPDATE LOCATIONS
// ============================================

/**
 * POST /api/location/bulk-update
 * Body: { locations: [{ userId, sessionId, latitude, longitude, timestamp }] }
 * Saves multiple GPS points at once (for offline sync)
 */
router.post('/bulk-update', async (req, res) => {
  try {
    const { locations } = req.body;

    if (!locations || !Array.isArray(locations) || locations.length === 0) {
      return res.status(400).json({ message: 'locations array is required' });
    }

    console.log(`📦 Bulk update: ${locations.length} locations`);

    const savedLocations = [];
    const errors = [];
    const sessionUpdates = {};

    for (const point of locations) {
      try {
        const { userId, sessionId, latitude, longitude, timestamp, accuracy } = point;

        // ✅ Validate
        if (!userId || !sessionId || latitude === undefined || longitude === undefined) {
          errors.push({ point, error: 'Missing required fields' });
          continue;
        }

        // ✅ Save location
        const location = new Location({
          userId: userId,
          sessionId: sessionId,
          latitude: latitude,
          longitude: longitude,
          timestamp: timestamp ? new Date(timestamp) : new Date(),
          accuracy: accuracy || null
        });

        await location.save();
        savedLocations.push(location._id);

        // ✅ Track session updates (batch update later)
        if (!sessionUpdates[sessionId]) {
          sessionUpdates[sessionId] = {
            userId: userId,
            points: []
          };
        }
        sessionUpdates[sessionId].points.push({
          latitude: latitude,
          longitude: longitude,
          timestamp: new Date()
        });

      } catch (err) {
        errors.push({ point, error: err.message });
      }
    }

    // ✅ Update sessions with new points
    for (const [sessionId, data] of Object.entries(sessionUpdates)) {
      try {
        const session = await Session.findById(sessionId);
        if (session && session.status === 'ACTIVE') {
          // Add points
          for (const point of data.points) {
            const lastPoint = session.route.length > 0 
              ? session.route[session.route.length - 1] 
              : null;

            session.route.push(point);

            if (lastPoint) {
              const distance = calculateDistance(
                lastPoint.latitude, lastPoint.longitude,
                point.latitude, point.longitude
              );
              if (distance < 1) {
                session.totalDistanceKm += distance;
              }
            }
          }

          // Trim if needed
          if (session.route.length > 10000) {
            session.route = session.route.slice(-5000);
          }

          await session.save();
        }
      } catch (err) {
        console.error(`❌ Error updating session ${sessionId}:`, err);
      }
    }

    res.json({
      success: true,
      message: `${savedLocations.length} locations saved, ${errors.length} errors`,
      savedCount: savedLocations.length,
      errorCount: errors.length,
      errors: errors
    });

  } catch (err) {
    console.error('❌ Error in bulk update:', err);
    res.status(500).json({
      success: false,
      message: 'Error processing bulk update',
      error: err.message
    });
  }
});

// ============================================
// GET LOCATIONS BY SESSION
// ============================================

/**
 * GET /api/location/session/:sessionId
 * Get all locations for a session (with pagination)
 */
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;

    if (!sessionId) {
      return res.status(400).json({ message: 'sessionId is required' });
    }

    // ✅ Check session exists
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    // ✅ Get locations with pagination
    const [locations, total] = await Promise.all([
      Location.find({ sessionId: sessionId })
        .sort({ timestamp: 1 })
        .skip(skip)
        .limit(limit),
      Location.countDocuments({ sessionId: sessionId })
    ]);

    res.json({
      sessionId: sessionId,
      locations: locations,
      pagination: {
        page: page,
        limit: limit,
        total: total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });

  } catch (err) {
    console.error('❌ Error fetching locations:', err);
    res.status(500).json({
      message: 'Error fetching locations',
      error: err.message
    });
  }
});

// ============================================
// GET LOCATIONS BY USER
// ============================================

/**
 * GET /api/location/user/:userId
 * Get all locations for a user (paginated)
 */
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;

    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    // ✅ Build filter
    const filter = { userId: userId };
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = startDate;
      if (endDate) filter.timestamp.$lte = endDate;
    }

    // ✅ Get locations with pagination
    const [locations, total] = await Promise.all([
      Location.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit),
      Location.countDocuments(filter)
    ]);

    res.json({
      userId: userId,
      locations: locations,
      pagination: {
        page: page,
        limit: limit,
        total: total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });

  } catch (err) {
    console.error('❌ Error fetching user locations:', err);
    res.status(500).json({
      message: 'Error fetching user locations',
      error: err.message
    });
  }
});

// ============================================
// GET LATEST LOCATION
// ============================================

/**
 * GET /api/location/latest/:sessionId
 * Get the latest location for a session
 */
router.get('/latest/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ message: 'sessionId is required' });
    }

    // ✅ Check session exists
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    // ✅ Get latest location
    const location = await Location.findOne({ sessionId: sessionId })
      .sort({ timestamp: -1 });

    if (!location) {
      return res.status(404).json({ message: 'No locations found for this session' });
    }

    res.json({
      sessionId: sessionId,
      location: location
    });

  } catch (err) {
    console.error('❌ Error fetching latest location:', err);
    res.status(500).json({
      message: 'Error fetching latest location',
      error: err.message
    });
  }
});

// ============================================
// DELETE LOCATIONS
// ============================================

/**
 * DELETE /api/location/:locationId
 * Delete a single location (admin only)
 */
router.delete('/:locationId', async (req, res) => {
  try {
    const { locationId } = req.params;

    if (!locationId) {
      return res.status(400).json({ message: 'locationId is required' });
    }

    const location = await Location.findByIdAndDelete(locationId);
    if (!location) {
      return res.status(404).json({ message: 'Location not found' });
    }

    // ✅ Also remove from session route
    const session = await Session.findById(location.sessionId);
    if (session) {
      session.route = session.route.filter(p => 
        p.latitude !== location.latitude || 
        p.longitude !== location.longitude ||
        p.timestamp.getTime() !== location.timestamp.getTime()
      );
      await session.save();
    }

    res.json({
      message: 'Location deleted successfully',
      locationId: locationId
    });

  } catch (err) {
    console.error('❌ Error deleting location:', err);
    res.status(500).json({
      message: 'Error deleting location',
      error: err.message
    });
  }
});

// ============================================
// DELETE LOCATIONS BY SESSION
// ============================================

/**
 * DELETE /api/location/session/:sessionId
 * Delete all locations for a session (admin only)
 */
router.delete('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({ message: 'sessionId is required' });
    }

    // ✅ Check session exists
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    // ✅ Delete all locations
    const result = await Location.deleteMany({ sessionId: sessionId });

    // ✅ Clear route in session
    session.route = [];
    session.totalDistanceKm = 0;
    await session.save();

    res.json({
      message: `Deleted ${result.deletedCount} locations for session`,
      sessionId: sessionId,
      deletedCount: result.deletedCount
    });

  } catch (err) {
    console.error('❌ Error deleting session locations:', err);
    res.status(500).json({
      message: 'Error deleting session locations',
      error: err.message
    });
  }
});

module.exports = router;

//------------ 01.08.2026 --------------------------
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
