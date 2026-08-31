const express = require("express");
const router = express.Router();
const Location = require("../models/LocationModel/Location");
const Session = require("../models/FSEModel/Session");
const calculateDistance = require("../utils/distance");

// ✅ FIX 1: Less aggressive filters (matches real GPS accuracy)
const MAX_ACCEPTABLE_ACCURACY_METERS = 200;  // Increased from 150
const MAX_JUMP_METERS = 2000;
const MAX_JUMP_WINDOW_MS = 10000;
const MAX_PLAUSIBLE_SPEED_MPS = 100;
const DUPLICATE_WINDOW_MS = 5000;  // Increased from 3000
const DUPLICATE_DISTANCE_METERS = 10;  // ✅ INCREASED FROM 1 TO 10 METERS

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

  // ✅ FIX: 10 meters minimum (was 1 meter)
  return distanceMeters <= DUPLICATE_DISTANCE_METERS;
}

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

  // ✅ FIX: More lenient deduplication check (10 meters)
  if (lastRoutePoint && isDuplicatePoint(lastRoutePoint, lat, lng, timestamp)) {
    console.log(`📌 Duplicate point skipped for session ${sessionId} (within ${DUPLICATE_DISTANCE_METERS}m)`);
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

  // ✅ Save location
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
    // ✅ FIX: Keep even small distances (don't filter out)
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
    const routePage = parseInt(req.query.routePage, 10) || null;
    const routeLimit = Math.min(
      parseInt(req.query.routeLimit, 10) || 1000,
      5000,
    );

    let session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.status === "ACTIVE" || session.status === "AUTO_ENDED") {
      const rebuilt = await runExclusive(sessionId, async () => {
        return await rebuildSessionRoute(sessionId);
      });
      if (rebuilt) {
        session = rebuilt;
        console.log(
          `✅ Route rebuilt: ${session.route?.length || 0} points, ${session.totalDistanceKm}km`,
        );
      } else {
        console.log(`⚠️ No locations found for session ${sessionId}`);
      }
    }

    if (session.status === "ACTIVE") {
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      if (session.startTime < twentyFourHoursAgo) {
        console.log(`⏰ Session ${sessionId} is > 24 hours old, auto-ending`);
        session = await autoEndSessionIfStale(session);
      }
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
    console.error('❌ Error fetching session:', err.message);
    res
      .status(500)
      .json({ message: "Error fetching session", error: err.message });
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

// ─── AUTO-END STALE SESSIONS ────────────────────────────────────────────
async function autoEndSessionIfStale(session) {
  if (!session || session.status !== "ACTIVE") return session;

  const twentyFourHoursAgo = new Date();
  twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

  if (session.startTime > twentyFourHoursAgo) {
    console.log(`✅ Session ${session._id} is recent, keeping active`);
    return session;
  }

  if (!isFromPreviousDay(session.startTime)) return session;

  return runExclusive(session._id, async () => {
    const fresh = await Session.findById(session._id);
    if (!fresh || fresh.status !== "ACTIVE") return fresh || session;

    const rebuilt = await rebuildSessionRoute(session._id);
    const finalSession = rebuilt || fresh;

    finalSession.status = "AUTO_ENDED";
    finalSession.endTime = finalSession.endTime || new Date();
    await finalSession.save();

    console.log(`🧹 Auto-ended session ${finalSession._id}`);
    return finalSession;
  });
}

function getStartOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isFromPreviousDay(date) {
  return new Date(date) < getStartOfToday();
}

module.exports = router;
