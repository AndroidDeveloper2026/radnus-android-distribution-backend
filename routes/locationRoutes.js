const express = require("express");
const router = express.Router();
const Location = require("../models/LocationModel/Location");

// GET all users location
// router.get("/", async (req, res) => {
//   const locations = await Location.find();
//   res.json(locations);
// });

router.get("/route/:sessionId", async (req, res) => {
  try {
    const data = await Location.find({
      sessionId: req.params.sessionId,
    }).sort({ timestamp: 1 });

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;