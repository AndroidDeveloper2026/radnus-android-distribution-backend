
// sessionRoutes.js — COMPLETE FIXED VERSION (with Attendance integration)

const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Session = require("../models/FSEModel/Session");
const Location = require("../models/LocationModel/Location");
const calculateDistance = require("../utils/distance");
const { runExclusive } = require("../utils/sessionLock");
const {
  requireTrackedRole,
  requireAdmin,
  requireUserAccess,
  requireSessionAccess,
} = require("../middleware/hierarchyAccess");
const { canViewUser } = require("../utils/hierarchyScope");
const {
  upsertCheckIn,
  upsertCheckOut,
} = require("../services/attendanceService");

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// ─── Date helpers ─────────────────────────────────────────────────────

function getStartOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function isFromPreviousDay(date) {
  return new Date(date) < getStartOfToday();
}

// ─── Route rebuild helper ─────────────────────────────────────────────

async function rebuildSessionRoute(sessionId) {
  try {
    console.log(`🔄 Rebuilding route for session ${sessionId}`);

    const locations = await Location.find({ sessionId })
      .sort({ timestamp: 1 })
      .lean();

    if (locations.length === 0) {
      console.log(`⚠️ No locations found for session ${sessionId}`);
      // ✅ FIX: check if session has route points already
      const session = await Session.findById(sessionId).select(
        "route pointCount totalDistanceKm"
      );
      if (session && session.route && session.route.length > 0) {
        console.log(
          `📌 Session has ${session.route.length} route points, updating pointCount`
        );
        await Session.findByIdAndUpdate(sessionId, {
          pointCount: session.route.length,
        });
        return session;
      }
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
        curr.longitude
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
      { new: true }
    );

    console.log(
      `✅ Route rebuilt: ${locations.length} points, ${totalDistance.toFixed(4)}km`
    );
    return updatedSession;
  } catch (err) {
    console.error(
      `❌ Failed to rebuild route for session ${sessionId}:`,
      err.message
    );
    return null;
  }
}

// ─── Auto-end stale sessions ──────────────────────────────────────────

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

    // ⭐ Auto-close attendance too, so an FSE who forgot to tap END DAY
    // doesn't stay "WORKING" forever. Best-effort: failure here must not
    // prevent the session auto-end.
    try {
      await upsertCheckOut({
        employeeId: finalSession.userId,
        when: finalSession.endTime || new Date(),
        location: null,
      });
    } catch (attErr) {
      console.error(
        "⚠️ Could not auto-close attendance on stale session:",
        attErr.message
      );
    }

    console.log(`🧹 Auto-ended session ${finalSession._id}`);
    return finalSession;
  });
}

async function cleanupStaleSessions() {
  try {
    const staleSessions = await Session.find({
      status: "ACTIVE",
      startTime: { $lt: getStartOfToday() },
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

// ─── GET ALL SESSIONS ──────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const skip = (page - 1) * limit;
    const { userId, status } = req.query;
    const filter = {};

    // Visibility: self + people below me (Admin: everyone).
    if (userId) {
      if (!(await canViewUser(req.user, userId))) {
        return res.status(403).json({
          success: false,
          message: "You are not allowed to view this user",
        });
      }
      filter.userId = String(userId);
    } else if (req.user.role !== "Admin") {
      filter.userId = String(req.user.id); // default: my own sessions only
    }
    if (status) filter.status = status;

    const [sessions, total] = await Promise.all([
      Session.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("-route") // Exclude route for performance
        .lean(),
      Session.countDocuments(filter),
    ]);

    // ✅ Ensure pointCount and totalDistanceKm are populated
    const enrichedSessions = sessions.map((session) => ({
      ...session,
      pointCount: session.pointCount ?? 0,
      totalDistanceKm: session.totalDistanceKm ?? 0,
    }));

    res.status(200).json({
      success: true,
      sessions: enrichedSessions,
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
router.get("/today/:userId", requireUserAccess, async (req, res) => {
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
    res.status(500).json({
      message: "Error checking session",
      error: err.message,
    });
  }
});

// ─── ORPHANED SESSION CHECK ─────────────────────────────────────────────
router.get("/orphaned/:userId", requireUserAccess, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const orphaned = await Session.findOne({
      userId,
      status: "ACTIVE",
      startTime: { $lt: getStartOfToday() },
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
    res.status(500).json({
      message: "Error checking orphaned session",
      error: err.message,
    });
  }
});

// ─── START SESSION (+ ATTENDANCE CHECK-IN) ──────────────────────────────
//
// Existing FSE behaviour is preserved:
//   • Creates (or returns today's existing) Session
//   • Saves the start point to Location
//   • Starts the native GPS tracking flow (client side)
//
// NEW: creates/updates the FSE's Attendance for today, with the Session
// id linked. Wrapped in a Mongo transaction so Session and Attendance
// either both land or neither does. Falls back to sequential writes
// when the deployment doesn't support transactions (same pattern as
// purchaseController.createPurchaseEntry).
//
router.post("/start", requireTrackedRole, async (req, res) => {
  const mongoSession = await mongoose.startSession();

  try {
    const { latitude, longitude } = req.body;
    const userId = String(req.user.id); // never trust a client userId

    if (!userId || userId.trim() === "") {
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

    // ── The actual work — runnable inside or outside a transaction ──
    const doWork = async (session) => {
      const sess = session || null; // Mongo session or null

      // 1. Reuse today's existing session if there is one
      const existingSession = await Session.findOne({
        userId,
        status: { $in: ["ACTIVE", "AUTO_ENDED"] },
        startTime: { $gte: startOfDay, $lte: endOfDay },
      }).session(sess);

      let savedSession = existingSession;

      // 2. Otherwise create a new one (identical to old behaviour)
      if (!savedSession) {
        const lockedStartLocation = { latitude: lat, longitude: lng };

        const created = await Session.create(
          [
            {
              userId,
              startLocation: lockedStartLocation,
              route: [{ latitude: lat, longitude: lng, timestamp: new Date() }],
              status: "ACTIVE",
              totalDistanceKm: 0,
              pointCount: 1,
            },
          ],
          sess ? { session: sess } : undefined
        );
        savedSession = created[0];
        console.log(`✅ Session created - sessionId: ${savedSession._id}`);

        // 3. Save start point to Location (unchanged behaviour)
        try {
          await Location.create(
            [
              {
                userId,
                sessionId: savedSession._id,
                latitude: lat,
                longitude: lng,
                timestamp: savedSession.startTime,
                accuracy: 0,
              },
            ],
            sess ? { session: sess } : undefined
          );
          console.log(
            `✅ Start point saved to Location for session ${savedSession._id}`
          );
        } catch (locErr) {
          console.error(
            "⚠️ Could not save start point to Location:",
            locErr.message
          );
        }
      } else {
        console.log(
          `⚠️ Session already exists for today - sessionId: ${existingSession._id}`
        );
      }

      // 4. ⭐ FSE Attendance — the START DAY is the FSE Check-In.
      //    Idempotent: if the FSE already checked in today, this is a no-op
      //    and just returns the existing attendance record.
      const { attendance, alreadyCheckedIn } = await upsertCheckIn({
        employeeId: userId,
        when: savedSession.startTime || new Date(),
        location: { latitude: lat, longitude: lng, accuracy: 0 },
        sessionId: savedSession._id,
      });

      return { session: savedSession, attendance, alreadyCheckedIn };
    };

    // ── Try transactional path first ────────────────────────────────
    let result;
    try {
      await mongoSession.withTransaction(async () => {
        result = await doWork(mongoSession);
      });
    } catch (txErr) {
      const msg = txErr?.message || "";
      const transactionsUnsupported =
        /Transaction numbers|IllegalOperation|replica set|not supported|Mongos/i.test(
          msg
        );

      if (transactionsUnsupported) {
        console.warn(
          "MongoDB transactions unsupported on this deployment — falling back to sequential (non-transactional) save:",
          msg
        );
        result = await doWork(null);
      } else {
        throw txErr;
      }
    }

    // ── Response ────────────────────────────────────────────────────
    // Return the Session as the top-level payload (same shape as before
    // so any existing client code that reads `response.data._id` etc.
    // keeps working). Attendance is included as an extra field.
    res.status(201).json({
      ...result.session.toObject(),
      attendance: result.attendance,
      alreadyCheckedIn: result.alreadyCheckedIn,
    });
  } catch (err) {
    console.log("❌ ERROR in /start:", err.message);
    res.status(500).json({
      message: "Error starting session",
      error: err.message,
      details: err.name === "ValidationError" ? err.errors : null,
    });
  } finally {
    mongoSession.endSession();
  }
});

// ─── END SESSION (+ ATTENDANCE CHECK-OUT) ───────────────────────────────
router.post("/end", requireTrackedRole, async (req, res) => {
  try {
    const { sessionId, finalLocation } = req.body;
    if (!sessionId) {
      return res.status(400).json({ message: "Session ID required" });
    }

    // Only the owner can end their own day.
    const ownsSession = await Session.exists({
      _id: sessionId,
      userId: String(req.user.id),
    });
    if (!ownsSession) {
      return res
        .status(403)
        .json({ message: "This session does not belong to you" });
    }

    console.log(`📤 Ending session: ${sessionId}`);

    const session = await runExclusive(sessionId, async () => {
      // 1. Save final location if provided (unchanged behaviour)
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
              accuracy: 0,
            });
            console.log("✅ Final location saved");
          }
        } catch (locErr) {
          console.error("⚠️ Could not save final location:", locErr.message);
        }
      }

      // 2. Rebuild route from all Location points (unchanged)
      const rebuilt = await rebuildSessionRoute(sessionId);

      // 3. Mark session ENDED (unchanged)
      const updated = await Session.findByIdAndUpdate(
        sessionId,
        {
          status: "ENDED",
          endTime: new Date(),
        },
        { new: true }
      );

      // 4. ⭐ Close the FSE's Attendance for today.
      //    Best-effort: if attendance was never opened (e.g. legacy
      //    session from before this feature existed), END DAY still
      //    succeeds — the FSE can't be blocked from closing their day
      //    because of an HR record.
      if (updated) {
        try {
          await upsertCheckOut({
            employeeId: updated.userId,
            when: updated.endTime || new Date(),
            location:
              finalLocation &&
              finalLocation.latitude != null &&
              finalLocation.longitude != null
                ? {
                    latitude: finalLocation.latitude,
                    longitude: finalLocation.longitude,
                    accuracy: 0,
                  }
                : null,
          });
        } catch (attErr) {
          console.error(
            "⚠️ Could not close attendance on END DAY:",
            attErr.message
          );
        }
      }

      return updated;
    });

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    console.log(
      `✅ Session ended - ${sessionId}, Distance: ${session.totalDistanceKm}km, Points: ${session.pointCount}`
    );
    res.json(session);
  } catch (err) {
    console.error("❌ Error ending session:", err.message);
    res.status(500).json({
      message: "Error ending session",
      error: err.message,
    });
  }
});

// ─── FORCE REBUILD ENDPOINT ─────────────────────────────────────────────
router.post("/rebuild/:sessionId", requireSessionAccess(), async (req, res) => {
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
router.get("/:sessionId", requireSessionAccess(), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const routePage = parseInt(req.query.routePage, 10) || null;
    const routeLimit = Math.min(
      parseInt(req.query.routeLimit, 10) || 1000,
      5000
    );

    let session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // ✅ Always rebuild route for ACTIVE or AUTO_ENDED sessions
    const shouldRebuild =
      session.status === "ACTIVE" ||
      session.status === "AUTO_ENDED" ||
      (session.route?.length === 0 && session.pointCount > 0);

    if (shouldRebuild) {
      console.log(`🔄 Rebuilding route for session ${sessionId}`);
      const rebuilt = await runExclusive(sessionId, async () => {
        return await rebuildSessionRoute(sessionId);
      });
      if (rebuilt) {
        session = rebuilt;
        console.log(
          `✅ Route rebuilt: ${session.route?.length || 0} points, ${session.totalDistanceKm}km`
        );
      } else {
        console.log(`⚠️ No locations found for session ${sessionId}`);
        if (session.pointCount === 0 && session.route?.length > 0) {
          session.pointCount = session.route.length;
          await session.save();
        }
      }
    }

    // ✅ Auto-end if stale (24+ hours old)
    if (session.status === "ACTIVE") {
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      if (session.startTime < twentyFourHoursAgo) {
        console.log(`⏰ Session ${sessionId} is > 24 hours old, auto-ending`);
        session = await autoEndSessionIfStale(session);
      }
    }

    // ✅ Paginate route if requested
    if (routePage) {
      const sessionObj = session.toObject();
      const start = (routePage - 1) * routeLimit;
      const totalPoints = sessionObj.route?.length || 0;
      sessionObj.route =
        sessionObj.route?.slice(start, start + routeLimit) || [];
      sessionObj.routePagination = {
        page: routePage,
        limit: routeLimit,
        total: totalPoints,
        totalPages: Math.ceil(totalPoints / routeLimit),
      };
      return res.json(sessionObj);
    }

    // ✅ Ensure response always has route array
    const response = session.toObject ? session.toObject() : session;
    if (!response.route) response.route = [];
    if (response.pointCount === undefined) {
      response.pointCount = response.route.length;
    }
    if (response.totalDistanceKm === undefined) {
      response.totalDistanceKm = 0;
    }

    res.json(response);
  } catch (err) {
    console.error("❌ Error fetching session:", err.message);
    res.status(500).json({
      message: "Error fetching session",
      error: err.message,
    });
  }
});

// ─── FIX OLD SESSIONS ENDPOINT ──────────────────────────────────────────
router.post("/fix-sessions", requireAdmin, async (req, res) => {
  try {
    const sessions = await Session.find({
      pointCount: 0,
      status: { $in: ["ENDED", "AUTO_ENDED"] },
    });

    let fixed = 0;
    for (const session of sessions) {
      const count = session.route?.length || 0;
      if (count > 0) {
        await Session.findByIdAndUpdate(session._id, {
          pointCount: count,
          totalDistanceKm: session.totalDistanceKm || 0,
        });
        fixed++;
        console.log(`✅ Fixed session ${session._id}: ${count} points`);
      }
    }

    res.json({
      success: true,
      fixed,
      total: sessions.length,
      message: `Fixed ${fixed} sessions with missing pointCount`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

//------------------ 05.10.26 Backup ------------------
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
//       // ✅ FIX: Check if session has route points already
//       const session = await Session.findById(sessionId).select("route pointCount totalDistanceKm");
//       if (session && session.route && session.route.length > 0) {
//         console.log(`📌 Session has ${session.route.length} route points, updating pointCount`);
//         await Session.findByIdAndUpdate(sessionId, {
//           pointCount: session.route.length
//         });
//         return session;
//       }
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
//         .select("-route") // Exclude route for performance
//         .lean(),
//       Session.countDocuments(filter),
//     ]);

//     // ✅ FIX: Ensure pointCount and totalDistanceKm are populated
//     const enrichedSessions = sessions.map(session => ({
//       ...session,
//       pointCount: session.pointCount ?? 0,
//       totalDistanceKm: session.totalDistanceKm ?? 0,
//     }));

//     res.status(200).json({
//       success: true,
//       sessions: enrichedSessions,
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
//         accuracy: 0,
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
//               accuracy: 0,
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

//     // ✅ FIX: Always rebuild route for ACTIVE or AUTO_ENDED sessions
//     const shouldRebuild = 
//       session.status === "ACTIVE" || 
//       session.status === "AUTO_ENDED" ||
//       (session.route?.length === 0 && session.pointCount > 0);

//     if (shouldRebuild) {
//       console.log(`🔄 Rebuilding route for session ${sessionId}`);
//       const rebuilt = await runExclusive(sessionId, async () => {
//         return await rebuildSessionRoute(sessionId);
//       });
//       if (rebuilt) {
//         session = rebuilt;
//         console.log(`✅ Route rebuilt: ${session.route?.length || 0} points, ${session.totalDistanceKm}km`);
//       } else {
//         console.log(`⚠️ No locations found for session ${sessionId}`);
//         // ✅ Even if no locations, ensure pointCount is correct
//         if (session.pointCount === 0 && session.route?.length > 0) {
//           session.pointCount = session.route.length;
//           await session.save();
//         }
//       }
//     }

//     // ✅ Auto-end if stale (24+ hours old)
//     if (session.status === "ACTIVE") {
//       const twentyFourHoursAgo = new Date();
//       twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

//       if (session.startTime < twentyFourHoursAgo) {
//         console.log(`⏰ Session ${sessionId} is > 24 hours old, auto-ending`);
//         session = await autoEndSessionIfStale(session);
//       }
//     }

//     // ✅ Paginate route if requested
//     if (routePage) {
//       const sessionObj = session.toObject();
//       const start = (routePage - 1) * routeLimit;
//       const totalPoints = sessionObj.route?.length || 0;
//       sessionObj.route = sessionObj.route?.slice(start, start + routeLimit) || [];
//       sessionObj.routePagination = {
//         page: routePage,
//         limit: routeLimit,
//         total: totalPoints,
//         totalPages: Math.ceil(totalPoints / routeLimit),
//       };
//       return res.json(sessionObj);
//     }

//     // ✅ Ensure response always has route array
//     const response = session.toObject ? session.toObject() : session;
//     if (!response.route) response.route = [];
//     if (response.pointCount === undefined) {
//       response.pointCount = response.route.length;
//     }
//     if (response.totalDistanceKm === undefined) {
//       response.totalDistanceKm = 0;
//     }

//     res.json(response);
//   } catch (err) {
//     console.error("❌ Error fetching session:", err.message);
//     res
//       .status(500)
//       .json({ message: "Error fetching session", error: err.message });
//   }
// });

// // ─── FIX OLD SESSIONS ENDPOINT ──────────────────────────────────────────
// router.post("/fix-sessions", async (req, res) => {
//   try {
//     const sessions = await Session.find({
//       pointCount: 0,
//       status: { $in: ["ENDED", "AUTO_ENDED"] }
//     });
    
//     let fixed = 0;
//     for (const session of sessions) {
//       const count = session.route?.length || 0;
//       if (count > 0) {
//         await Session.findByIdAndUpdate(session._id, { 
//           pointCount: count,
//           totalDistanceKm: session.totalDistanceKm || 0
//         });
//         fixed++;
//         console.log(`✅ Fixed session ${session._id}: ${count} points`);
//       }
//     }
    
//     res.json({ 
//       success: true, 
//       fixed, 
//       total: sessions.length,
//       message: `Fixed ${fixed} sessions with missing pointCount`
//     });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

// module.exports = router;