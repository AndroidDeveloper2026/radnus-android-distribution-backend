// sessionRoutes.js - COMPLETE FIXED VERSION
// Fixes: Session auto-end prevention, proper status checking

const express = require("express");
const router = express.Router();
const Session = require("../models/FSEModel/Session");
const Location = require("../models/LocationModel/Location");
const calculateDistance = require("../utils/distance");
const { runExclusive } = require("../utils/sessionLock");

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function getStartOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isFromPreviousDay(date) {
  return new Date(date) < getStartOfToday();
}

// ─── Route rebuild helper ──────────────────────────────────────────────
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
        prev.latitude,
        prev.longitude,
        curr.latitude,
        curr.longitude,
      );
    }

    const route = locations.map((l) => ({
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
      { new: true },
    );

    console.log(
      `✅ Route rebuilt: ${locations.length} points, ${totalDistance.toFixed(4)}km`,
    );
    return updatedSession;
  } catch (err) {
    console.error(
      `❌ Failed to rebuild route for session ${sessionId}:`,
      err.message,
    );
    return null;
  }
}

// ✅ FIX: Auto-end only for sessions older than 30 minutes
async function autoEndSessionIfStale(session) {
  if (!session || session.status !== "ACTIVE") return session;

  const thirtyMinutesAgo = new Date();
  thirtyMinutesAgo.setMinutes(thirtyMinutesAgo.getMinutes() - 30);

  // ✅ FIX: Don't auto-end sessions less than 30 minutes old
  if (session.startTime > thirtyMinutesAgo) {
    console.log(`✅ Session ${session._id} is recent (< 30 mins), keeping active`);
    return session;
  }

  // ✅ FIX: Only auto-end if from previous day
  if (!isFromPreviousDay(session.startTime)) {
    console.log(`✅ Session ${session._id} is from today, keeping active`);
    return session;
  }

  console.log(`⏰ Session ${session._id} is stale (> 30 mins and from previous day), auto-ending`);

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

async function cleanupStaleSessions() {
  try {
    const startOfDay = getStartOfToday();
    const staleSessions = await Session.find({
      status: "ACTIVE",
      startTime: { $lt: startOfDay },
    });

    for (const session of staleSessions) {
      await autoEndSessionIfStale(session);
    }
  } catch (err) {
    console.log("❌ Error during stale session cleanup:", err.message);
  }
}

cleanupStaleSessions();
setInterval(cleanupStaleSessions, CLEANUP_INTERVAL_MS);

// ─── GET ALL SESSIONS ────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
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
        .select("-route"),
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
    console.log("❌ Error fetching sessions:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── CHECK TODAY'S SESSION ──────────────────────────────────────────────
router.get("/today/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const startOfDay = getStartOfToday();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    let session = await Session.findOne({
      userId,
      status: { $in: ["ACTIVE", "AUTO_ENDED"] },
      startTime: { $gte: startOfDay, $lte: endOfDay },
    });

    if (!session) {
      return res.status(404).json({ message: "No active session today" });
    }

    // ✅ FIX: Check if session should be auto-ended (but only if > 30 mins)
    if (session.status === "ACTIVE") {
      const thirtyMinutesAgo = new Date();
      thirtyMinutesAgo.setMinutes(thirtyMinutesAgo.getMinutes() - 30);
      
      if (session.startTime < thirtyMinutesAgo && isFromPreviousDay(session.startTime)) {
        session = await autoEndSessionIfStale(session);
      }
    }

    if (session.status === "ACTIVE" || session.status === "AUTO_ENDED") {
      const sid = session._id.toString();
      const rebuilt = await runExclusive(sid, async () => {
        return await rebuildSessionRoute(sid);
      });
      if (rebuilt) session = rebuilt;
    }

    res.json(session);
  } catch (err) {
    console.log("❌ Error in /today/:userId:", err);
    res
      .status(500)
      .json({ message: "Error checking session", error: err.message });
  }
});

// ─── ORPHANED SESSION CHECK ─────────────────────────────────────────────
router.get("/orphaned/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const startOfDay = getStartOfToday();
    const orphaned = await Session.findOne({
      userId,
      status: "ACTIVE",
      startTime: { $lt: startOfDay },
    });

    if (!orphaned) {
      return res.status(404).json({ message: "No orphaned session found" });
    }

    const sid = orphaned._id.toString();
    const rebuilt = await runExclusive(sid, async () => {
      return await rebuildSessionRoute(sid);
    });
    res.json(rebuilt || orphaned);
  } catch (err) {
    console.log("❌ Error checking orphaned session:", err.message);
    res
      .status(500)
      .json({ message: "Error checking orphaned session", error: err.message });
  }
});

// ─── START SESSION ──────────────────────────────────────────────────────
router.post("/start", async (req, res) => {
  try {
    const { userId, latitude, longitude } = req.body;

    if (!userId || userId.toString().trim() === "") {
      return res.status(400).json({ message: "userId is required" });
    }
    if (latitude === undefined || latitude === null || latitude === "") {
      return res.status(400).json({ message: "latitude is required" });
    }
    if (longitude === undefined || longitude === null || longitude === "") {
      return res.status(400).json({ message: "longitude is required" });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng)) {
      return res
        .status(400)
        .json({ message: "latitude and longitude must be valid numbers" });
    }

    const startOfDay = getStartOfToday();
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const existingSession = await Session.findOne({
      userId,
      status: { $in: ["ACTIVE", "AUTO_ENDED"] },
      startTime: { $gte: startOfDay, $lte: endOfDay },
    });

    if (existingSession) {
      console.log(
        `⚠️ Session already exists for today - sessionId: ${existingSession._id}`,
      );
      return res.json(existingSession);
    }

    const lockedStartLocation = { latitude: lat, longitude: lng };

    const session = new Session({
      userId,
      startLocation: lockedStartLocation,
      route: [{ latitude: lat, longitude: lng, timestamp: new Date() }],
      status: "ACTIVE",
      totalDistanceKm: 0,
      pointCount: 1,
    });

    const savedSession = await session.save();
    console.log(`✅ Session created - sessionId: ${savedSession._id}`);

    try {
      await Location.create({
        userId,
        sessionId: savedSession._id,
        latitude: lat,
        longitude: lng,
        timestamp: savedSession.startTime,
      });
      console.log(
        `✅ Start point saved to Location for session ${savedSession._id}`,
      );
    } catch (locErr) {
      console.error(
        "⚠️ Could not save start point to Location:",
        locErr.message,
      );
    }

    res.status(201).json(savedSession);
  } catch (err) {
    console.log("❌ ERROR in /start:", err.message);
    res.status(500).json({
      message: "Error starting session",
      error: err.message,
      details: err.name === "ValidationError" ? err.errors : null,
    });
  }
});

// ─── END SESSION ────────────────────────────────────────────────────────
router.post("/end", async (req, res) => {
  try {
    const { sessionId, finalLocation } = req.body;
    if (!sessionId) {
      return res.status(400).json({ message: "Session ID required" });
    }

    console.log(`📤 Ending session: ${sessionId}`);

    const session = await runExclusive(sessionId, async () => {
      if (finalLocation && finalLocation.latitude && finalLocation.longitude) {
        try {
          const existing = await Session.findById(sessionId)
            .select("userId")
            .lean();
          if (existing) {
            await Location.create({
              userId: existing.userId,
              sessionId,
              latitude: finalLocation.latitude,
              longitude: finalLocation.longitude,
              timestamp: new Date(),
            });
            console.log("✅ Final location saved");
          }
        } catch (locErr) {
          console.error("⚠️ Could not save final location:", locErr.message);
        }
      }

      const rebuilt = await rebuildSessionRoute(sessionId);
      if (rebuilt) {
        const updated = await Session.findByIdAndUpdate(
          sessionId,
          {
            status: "ENDED",
            endTime: new Date(),
          },
          { new: true },
        );
        return updated;
      }

      const updated = await Session.findByIdAndUpdate(
        sessionId,
        {
          status: "ENDED",
          endTime: new Date(),
        },
        { new: true },
      );
      return updated;
    });

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    console.log(
      `✅ Session ended - ${sessionId}, Distance: ${session.totalDistanceKm}km, Points: ${session.pointCount}`,
    );
    res.json(session);
  } catch (err) {
    console.error("❌ Error ending session:", err.message);
    res
      .status(500)
      .json({ message: "Error ending session", error: err.message });
  }
});

// ─── FORCE REBUILD ENDPOINT ─────────────────────────────────────────────
router.post("/rebuild/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    console.log(`🔄 Manually rebuilding route for ${sessionId}`);

    const rebuilt = await runExclusive(sessionId, async () => {
      return await rebuildSessionRoute(sessionId);
    });

    if (rebuilt) {
      res.json({
        success: true,
        pointCount: rebuilt.pointCount,
        totalDistanceKm: rebuilt.totalDistanceKm,
        routeLength: rebuilt.route?.length || 0,
        session: rebuilt,
      });
    } else {
      res.json({
        success: false,
        message: "No locations found for this session",
      });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── GET SESSION BY ID ──────────────────────────────────────────────────
router.get("/:sessionId", async (req, res) => {
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

    // ✅ FIX: Auto-end check with 30 minute threshold
    if (session.status === "ACTIVE") {
      const thirtyMinutesAgo = new Date();
      thirtyMinutesAgo.setMinutes(thirtyMinutesAgo.getMinutes() - 30);
      
      if (session.startTime < thirtyMinutesAgo && isFromPreviousDay(session.startTime)) {
        console.log(`⏰ Session ${sessionId} is stale, auto-ending`);
        session = await autoEndSessionIfStale(session);
      }
    }

    if (session.status === "ACTIVE" || session.status === "AUTO_ENDED") {
      console.log(
        `🔄 Rebuilding route for session ${sessionId} (status: ${session.status})`,
      );
      const rebuilt = await runExclusive(sessionId, async () => {
        return await rebuildSessionRoute(sessionId);
      });
      if (rebuilt) {
        session = rebuilt;
        console.log(
          `✅ Route rebuilt: ${session.route?.length || 0} points, ${session.totalDistanceKm}km`,
        );
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
    console.error("❌ Error fetching session:", err.message);
    res
      .status(500)
      .json({ message: "Error fetching session", error: err.message });
  }
});

module.exports = router;

//---------------- 31.08.2026 -------------------------------
// // sessionRoutes.js - COMPLETE FIXED VERSION

// const express = require("express");
// const router = express.Router();
// const Session = require("../models/FSEModel/Session");
// const Location = require("../models/LocationModel/Location");
// const calculateDistance = require("../utils/distance");
// const { runExclusive } = require("../utils/sessionLock");

// const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// function getStartOfToday() {
//   const d = new Date();
//   d.setHours(0, 0, 0, 0);
//   return d;
// }

// function isFromPreviousDay(date) {
//   return new Date(date) < getStartOfToday();
// }

// // ─── Route rebuild helper ──────────────────────────────────────────────
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
//         prev.latitude,
//         prev.longitude,
//         curr.latitude,
//         curr.longitude,
//       );
//     }

//     const route = locations.map((l) => ({
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
//       { new: true },
//     );

//     console.log(
//       `✅ Route rebuilt: ${locations.length} points, ${totalDistance.toFixed(4)}km`,
//     );
//     return updatedSession;
//   } catch (err) {
//     console.error(
//       `❌ Failed to rebuild route for session ${sessionId}:`,
//       err.message,
//     );
//     return null;
//   }
// }

// // ─── Auto-end stale sessions ────────────────────────────────────────────
// async function autoEndSessionIfStale(session) {
//   if (!session || session.status !== "ACTIVE") return session;

//   const twentyFourHoursAgo = new Date();
//   twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

//   if (session.startTime > twentyFourHoursAgo) {
//     console.log(`✅ Session ${session._id} is recent, keeping active`);
//     return session;
//   }

//   if (!isFromPreviousDay(session.startTime)) return session;

//   return runExclusive(session._id, async () => {
//     const fresh = await Session.findById(session._id);
//     if (!fresh || fresh.status !== "ACTIVE") return fresh || session;

//     const rebuilt = await rebuildSessionRoute(session._id);
//     const finalSession = rebuilt || fresh;

//     finalSession.status = "AUTO_ENDED";
//     finalSession.endTime = finalSession.endTime || new Date();
//     await finalSession.save();

//     console.log(`🧹 Auto-ended session ${finalSession._id}`);
//     return finalSession;
//   });
// }

// async function cleanupStaleSessions() {
//   try {
//     const staleSessions = await Session.find({
//       status: "ACTIVE",
//       startTime: { $lt: getStartOfToday() },
//     });

//     for (const session of staleSessions) {
//       await autoEndSessionIfStale(session);
//     }
//   } catch (err) {
//     console.log("❌ Error during stale session cleanup:", err.message);
//   }
// }

// cleanupStaleSessions();
// setInterval(cleanupStaleSessions, CLEANUP_INTERVAL_MS);

// // ─── GET ALL SESSIONS ────────────────────────────────────────────────────
// router.get("/", async (req, res) => {
//   try {
//     const page = parseInt(req.query.page, 10) || 1;
//     const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
//     const skip = (page - 1) * limit;
//     const { userId, status } = req.query;
//     const filter = {};
//     if (userId) filter.userId = userId;
//     if (status) filter.status = status;

//     const [sessions, total] = await Promise.all([
//       Session.find(filter)
//         .sort({ createdAt: -1 })
//         .skip(skip)
//         .limit(limit)
//         .select("-route"),
//       Session.countDocuments(filter),
//     ]);

//     res.status(200).json({
//       success: true,
//       sessions,
//       pagination: {
//         page,
//         limit,
//         total,
//         totalPages: Math.ceil(total / limit),
//       },
//     });
//   } catch (err) {
//     console.log("❌ Error fetching sessions:", err.message);
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

// // ─── CHECK TODAY'S SESSION ──────────────────────────────────────────────
// router.get("/today/:userId", async (req, res) => {
//   try {
//     const { userId } = req.params;
//     if (!userId) {
//       return res.status(400).json({ message: "userId is required" });
//     }

//     const startOfDay = getStartOfToday();
//     const endOfDay = new Date();
//     endOfDay.setHours(23, 59, 59, 999);

//     let session = await Session.findOne({
//       userId,
//       status: { $in: ["ACTIVE", "AUTO_ENDED"] },
//       startTime: { $gte: startOfDay, $lte: endOfDay },
//     });

//     if (!session) {
//       return res.status(404).json({ message: "No active session today" });
//     }

//     if (session.status === "ACTIVE" || session.status === "AUTO_ENDED") {
//       const sid = session._id.toString();
//       const rebuilt = await runExclusive(sid, async () => {
//         return await rebuildSessionRoute(sid);
//       });
//       if (rebuilt) session = rebuilt;
//     }

//     res.json(session);
//   } catch (err) {
//     console.log("❌ Error in /today/:userId:", err);
//     res
//       .status(500)
//       .json({ message: "Error checking session", error: err.message });
//   }
// });

// // ─── ORPHANED SESSION CHECK ─────────────────────────────────────────────
// router.get("/orphaned/:userId", async (req, res) => {
//   try {
//     const { userId } = req.params;
//     if (!userId) {
//       return res.status(400).json({ message: "userId is required" });
//     }

//     const orphaned = await Session.findOne({
//       userId,
//       status: "ACTIVE",
//       startTime: { $lt: getStartOfToday() },
//     });

//     if (!orphaned) {
//       return res.status(404).json({ message: "No orphaned session found" });
//     }

//     const sid = orphaned._id.toString();
//     const rebuilt = await runExclusive(sid, async () => {
//       return await rebuildSessionRoute(sid);
//     });
//     res.json(rebuilt || orphaned);
//   } catch (err) {
//     console.log("❌ Error checking orphaned session:", err.message);
//     res
//       .status(500)
//       .json({ message: "Error checking orphaned session", error: err.message });
//   }
// });

// // ─── START SESSION ──────────────────────────────────────────────────────
// router.post("/start", async (req, res) => {
//   try {
//     const { userId, latitude, longitude } = req.body;

//     if (!userId || userId.toString().trim() === "") {
//       return res.status(400).json({ message: "userId is required" });
//     }
//     if (latitude === undefined || latitude === null || latitude === "") {
//       return res.status(400).json({ message: "latitude is required" });
//     }
//     if (longitude === undefined || longitude === null || longitude === "") {
//       return res.status(400).json({ message: "longitude is required" });
//     }

//     const lat = parseFloat(latitude);
//     const lng = parseFloat(longitude);
//     if (isNaN(lat) || isNaN(lng)) {
//       return res
//         .status(400)
//         .json({ message: "latitude and longitude must be valid numbers" });
//     }

//     const startOfDay = getStartOfToday();
//     const endOfDay = new Date();
//     endOfDay.setHours(23, 59, 59, 999);

//     const existingSession = await Session.findOne({
//       userId,
//       status: { $in: ["ACTIVE", "AUTO_ENDED"] },
//       startTime: { $gte: startOfDay, $lte: endOfDay },
//     });

//     if (existingSession) {
//       console.log(
//         `⚠️ Session already exists for today - sessionId: ${existingSession._id}`,
//       );
//       return res.json(existingSession);
//     }

//     const lockedStartLocation = { latitude: lat, longitude: lng };

//     const session = new Session({
//       userId,
//       startLocation: lockedStartLocation,
//       route: [{ latitude: lat, longitude: lng, timestamp: new Date() }],
//       status: "ACTIVE",
//       totalDistanceKm: 0,
//       pointCount: 1,
//     });

//     const savedSession = await session.save();
//     console.log(`✅ Session created - sessionId: ${savedSession._id}`);

//     try {
//       await Location.create({
//         userId,
//         sessionId: savedSession._id,
//         latitude: lat,
//         longitude: lng,
//         timestamp: savedSession.startTime,
//       });
//       console.log(
//         `✅ Start point saved to Location for session ${savedSession._id}`,
//       );
//     } catch (locErr) {
//       console.error(
//         "⚠️ Could not save start point to Location:",
//         locErr.message,
//       );
//     }

//     res.status(201).json(savedSession);
//   } catch (err) {
//     console.log("❌ ERROR in /start:", err.message);
//     res.status(500).json({
//       message: "Error starting session",
//       error: err.message,
//       details: err.name === "ValidationError" ? err.errors : null,
//     });
//   }
// });

// // ─── END SESSION ────────────────────────────────────────────────────────
// router.post("/end", async (req, res) => {
//   try {
//     const { sessionId, finalLocation } = req.body;
//     if (!sessionId) {
//       return res.status(400).json({ message: "Session ID required" });
//     }

//     console.log(`📤 Ending session: ${sessionId}`);

//     const session = await runExclusive(sessionId, async () => {
//       if (finalLocation && finalLocation.latitude && finalLocation.longitude) {
//         try {
//           const existing = await Session.findById(sessionId)
//             .select("userId")
//             .lean();
//           if (existing) {
//             await Location.create({
//               userId: existing.userId,
//               sessionId,
//               latitude: finalLocation.latitude,
//               longitude: finalLocation.longitude,
//               timestamp: new Date(),
//             });
//             console.log("✅ Final location saved");
//           }
//         } catch (locErr) {
//           console.error("⚠️ Could not save final location:", locErr.message);
//         }
//       }

//       const rebuilt = await rebuildSessionRoute(sessionId);
//       if (rebuilt) {
//         const updated = await Session.findByIdAndUpdate(
//           sessionId,
//           {
//             status: "ENDED",
//             endTime: new Date(),
//           },
//           { new: true },
//         );
//         return updated;
//       }

//       const updated = await Session.findByIdAndUpdate(
//         sessionId,
//         {
//           status: "ENDED",
//           endTime: new Date(),
//         },
//         { new: true },
//       );
//       return updated;
//     });

//     if (!session) {
//       return res.status(404).json({ message: "Session not found" });
//     }

//     console.log(
//       `✅ Session ended - ${sessionId}, Distance: ${session.totalDistanceKm}km, Points: ${session.pointCount}`,
//     );
//     res.json(session);
//   } catch (err) {
//     console.error("❌ Error ending session:", err.message);
//     res
//       .status(500)
//       .json({ message: "Error ending session", error: err.message });
//   }
// });

// // ─── FORCE REBUILD ENDPOINT ─────────────────────────────────────────────
// router.post("/rebuild/:sessionId", async (req, res) => {
//   try {
//     const { sessionId } = req.params;
//     console.log(`🔄 Manually rebuilding route for ${sessionId}`);

//     const rebuilt = await runExclusive(sessionId, async () => {
//       return await rebuildSessionRoute(sessionId);
//     });

//     if (rebuilt) {
//       res.json({
//         success: true,
//         pointCount: rebuilt.pointCount,
//         totalDistanceKm: rebuilt.totalDistanceKm,
//         routeLength: rebuilt.route?.length || 0,
//         session: rebuilt,
//       });
//     } else {
//       res.json({
//         success: false,
//         message: "No locations found for this session",
//       });
//     }
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// });

// // ─── GET SESSION BY ID ──────────────────────────────────────────────────
// router.get("/:sessionId", async (req, res) => {
//   try {
//     const { sessionId } = req.params;
//     const routePage = parseInt(req.query.routePage, 10) || null;
//     const routeLimit = Math.min(
//       parseInt(req.query.routeLimit, 10) || 1000,
//       5000,
//     );

//     let session = await Session.findById(sessionId);
//     if (!session) {
//       return res.status(404).json({ message: "Session not found" });
//     }

//     if (session.status === "ACTIVE" || session.status === "AUTO_ENDED") {
//       const rebuilt = await runExclusive(sessionId, async () => {
//         return await rebuildSessionRoute(sessionId);
//       });
//       if (rebuilt) {
//         session = rebuilt;
//         console.log(
//           `✅ Route rebuilt: ${session.route?.length || 0} points, ${session.totalDistanceKm}km`,
//         );
//       } else {
//         console.log(`⚠️ No locations found for session ${sessionId}`);
//       }
//     }

//     if (session.status === "ACTIVE") {
//       const twentyFourHoursAgo = new Date();
//       twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

//       if (session.startTime < twentyFourHoursAgo) {
//         console.log(`⏰ Session ${sessionId} is > 24 hours old, auto-ending`);
//         session = await autoEndSessionIfStale(session);
//       }
//     }

//     if (routePage) {
//       const sessionObj = session.toObject();
//       const start = (routePage - 1) * routeLimit;
//       const totalPoints = sessionObj.route.length;
//       sessionObj.route = sessionObj.route.slice(start, start + routeLimit);
//       sessionObj.routePagination = {
//         page: routePage,
//         limit: routeLimit,
//         total: totalPoints,
//         totalPages: Math.ceil(totalPoints / routeLimit),
//       };
//       return res.json(sessionObj);
//     }

//     res.json(session);
//   } catch (err) {
//     console.error("❌ Error fetching session:", err.message);
//     res
//       .status(500)
//       .json({ message: "Error fetching session", error: err.message });
//   }
// });

// module.exports = router;
