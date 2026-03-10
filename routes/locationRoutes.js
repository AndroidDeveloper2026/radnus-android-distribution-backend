const express = require("express");
const router = express.Router();
const Location = require("../models/LocationModel/Location");
const Session = require("../models/FSEModel/Session");
const calculateDistance = require("../utils/distance");

// ✅ UPDATE LOCATION AND CALCULATE DISTANCE
router.post("/update", async (req, res) => {
  try {
    const { userId, sessionId, latitude, longitude, timestamp } = req.body;

    if (!userId || !sessionId || !latitude || !longitude) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // ✅ Save location to Location collection
    const location = await Location.create({
      userId,
      sessionId,
      latitude,
      longitude,
      timestamp: timestamp || new Date()
    });

    // ✅ Get the session
    const session = await Session.findById(sessionId);

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // ✅ Calculate distance from previous location
    let distanceIncrement = 0;

    if (session.route.length > 0) {
      const lastPoint = session.route[session.route.length - 1];
      
      distanceIncrement = calculateDistance(
        lastPoint.latitude,
        lastPoint.longitude,
        latitude,
        longitude
      );

      // ✅ Only add distance if it's significant (avoid GPS jitter)
      if (distanceIncrement > 0.001) { // ~1 meter minimum
        session.totalDistanceKm += distanceIncrement;
      }
    }

    // ✅ Add new point to route
    session.route.push({
      latitude,
      longitude,
      timestamp: new Date()
    });

    // ✅ Save updated session
    await session.save();

    console.log(`✅ Location updated - Distance: ${distanceIncrement.toFixed(4)}km, Total: ${session.totalDistanceKm.toFixed(2)}km`);

    res.json({
      success: true,
      distance: distanceIncrement,
      totalDistance: session.totalDistanceKm,
      location: location
    });

  } catch (err) {
    console.log('❌ Error updating location:', err);
    res.status(500).json({ message: "Error updating location" });
  }
});

// ✅ GET ALL LOCATIONS FOR SESSION
router.get("/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    const locations = await Location.find({ sessionId })
      .sort({ timestamp: 1 });

    res.json(locations);

  } catch (err) {
    console.log('❌ Error fetching locations:', err);
    res.status(500).json({ message: "Error fetching locations" });
  }
});

// ✅ GET USER LOCATIONS
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const locations = await Location.find({ userId })
      .sort({ timestamp: -1 })
      .limit(100);

    res.json(locations);

  } catch (err) {
    console.log('❌ Error fetching user locations:', err);
    res.status(500).json({ message: "Error fetching user locations" });
  }
});

module.exports = router;
