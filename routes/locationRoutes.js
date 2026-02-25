const express = require("express");
const router = express.Router();
const Location = require("../models/LocationModel/Location");

// GET all users location
router.get("/", async (req, res) => {
  const locations = await Location.find();
  res.json(locations);
});

module.exports = router;