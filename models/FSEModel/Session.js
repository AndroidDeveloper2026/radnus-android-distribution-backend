// models/Session.js

const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema({
  userId: String,

  startLocation: {
    latitude: Number,
    longitude: Number,
  },

  startTime: {
    type: Date,
    default: Date.now,
  },

  endTime: Date,

  status: {
    type: String,
    enum: ["ACTIVE", "ENDED", "AUTO_ENDED"],
    default: "ACTIVE",
  },
});

module.exports = mongoose.model("Session", sessionSchema);