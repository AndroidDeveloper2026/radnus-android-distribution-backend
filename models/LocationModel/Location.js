const mongoose = require("mongoose");

const locationSchema = new mongoose.Schema({

  userId: {
    type: String,
    required: true,
    index: true
  },

  sessionId: {
    type: String,
    required: true,
    index: true
  },

  latitude: {
    type: Number,
    required: true
  },

  longitude: {
    type: Number,
    required: true
  },

  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }

});

// ✅ Compound index for efficient queries
locationSchema.index({ sessionId: 1, timestamp: 1 });
locationSchema.index({ userId: 1, timestamp: -1 });

module.exports = mongoose.model("Location", locationSchema);
