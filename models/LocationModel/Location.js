// models/Location.js

const mongoose = require("mongoose");

const locationSchema = new mongoose.Schema({
  userId: String,
  sessionId: String,

  latitude: Number,
  longitude: Number,

  timestamp: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Location", locationSchema);