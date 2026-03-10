const express = require("express");
const router = express.Router();
const Session = require("../models/FSEModel/Session");
const Location = require("../models/LocationModel/Location");
const calculateDistance = require("../utils/distance");

// ✅ CHECK TODAY'S SESSION
router.get("/today/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // ✅ Define today's date range
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // ✅ Find active session for today
    const session = await Session.findOne({
      userId,
      status: { $in: ["ACTIVE", "AUTO_ENDED"] },
      startTime: { $gte: startOfDay, $lte: endOfDay }
    });

    if (!session) {
      return res.status(404).json({ message: "No active session today" });
    }

    res.json(session);

  } catch (err) {
    console.log('❌ Error checking today session:', err);
    res.status(500).json({ message: "Error checking session" });
  }
});

// ✅ START NEW SESSION
router.post("/start", async (req, res) => {
  try {
    const { userId, latitude, longitude } = req.body;

    if (!userId || !latitude || !longitude) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // ✅ Define today's date range
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // ✅ Check if session already exists for today
    const existingSession = await Session.findOne({
      userId,
      status: { $in: ["ACTIVE", "AUTO_ENDED"] },
      startTime: { $gte: startOfDay, $lte: endOfDay }
    });

    if (existingSession) {
      console.log('⚠️ Session already exists for today:', existingSession._id);
      return res.json(existingSession);
    }

    // ✅ Create new session with start location
    const session = await Session.create({
      userId,
      startLocation: {
        latitude,
        longitude
      },
      route: [
        {
          latitude,
          longitude,
          timestamp: new Date()
        }
      ],
      status: "ACTIVE",
      totalDistanceKm: 0
    });

    console.log('✅ New session created:', session._id);
    res.json(session);

  } catch (err) {
    console.log('❌ Error starting session:', err);
    res.status(500).json({ message: "Error starting session" });
  }
});

// ✅ END SESSION
router.post("/end", async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ message: "Session ID required" });
    }

    // ✅ Update session to ENDED
    const session = await Session.findByIdAndUpdate(
      sessionId,
      {
        status: "ENDED",
        endTime: new Date()
      },
      { new: true }
    );

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    console.log('✅ Session ended:', sessionId);
    res.json(session);

  } catch (err) {
    console.log('❌ Error ending session:', err);
    res.status(500).json({ message: "Error ending session" });
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
    console.log('❌ Error fetching session:', err);
    res.status(500).json({ message: "Error fetching session" });
  }
});

module.exports = router;
