const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema({

  userId: {
    type: String,
    required: true,
    index: true
  },

  startLocation: {
    latitude: Number,
    longitude: Number
  },

  // ✅ Store all GPS coordinates for the route
  route: [
    {
      latitude: Number,
      longitude: Number,
      timestamp: { 
        type: Date, 
        default: Date.now 
      }
    }
  ],

  // ✅ Total distance traveled in kilometers
  totalDistanceKm: {
    type: Number,
    default: 0
  },

  // ✅ Session start time
  startTime: {
    type: Date,
    default: Date.now,
    index: true
  },

  // ✅ Session end time
  endTime: Date,

  // ✅ Session status
  status: {
    type: String,
    enum: ["ACTIVE", "ENDED", "AUTO_ENDED"],
    default: "ACTIVE",
    index: true
  },

  // ✅ Additional metadata
  metadata: {
    deviceInfo: String,
    appVersion: String,
  }

}, { timestamps: true });

module.exports = mongoose.model("Session", sessionSchema);
