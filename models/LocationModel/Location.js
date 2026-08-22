
/**
 * models/LocationModel/Location.js
 *
 * One document per GPS point received from a device.
 * The Session.route array is a *denormalised snapshot* rebuilt periodically
 * from this collection — the canonical source of truth for any session's path.
 */

'use strict';

const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema(
  {
    userId: {
      type:     String,
      required: true,
      index:    true,
    },
    sessionId: {
      type:     String,
      required: true,
      index:    true,
    },
    latitude: {
      type:     Number,
      required: true,
    },
    longitude: {
      type:     Number,
      required: true,
    },
    accuracy: {
      type:    Number,
      default: 0,
    },
    speed: {
      type:    Number,
      default: 0,
    },
    timestamp: {
      type:    Date,
      default: Date.now,
      index:   true,
    },
  },
  { timestamps: true },
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// Primary lookup: all points for a session in time order.
locationSchema.index({ sessionId: 1, timestamp: 1 });

// Admin / reporting: all points for a user in reverse-time order.
locationSchema.index({ userId: 1, timestamp: -1 });

// Compound for the dedup check inside processPoint.
locationSchema.index({ sessionId: 1, userId: 1, timestamp: -1 });

module.exports = mongoose.model('Location', locationSchema);

//========= 19.08.2026 ===================
// const mongoose = require("mongoose");

// const locationSchema = new mongoose.Schema({

//   userId: {
//     type: String,
//     required: true,
//     index: true
//   },

//   sessionId: {
//     type: String,
//     required: true,
//     index: true
//   },

//   latitude: {
//     type: Number,
//     required: true
//   },

//   longitude: {
//     type: Number,
//     required: true
//   },

//   timestamp: {
//     type: Date,
//     default: Date.now,
//     index: true
//   }

// });

// // ✅ Compound index for efficient queries
// locationSchema.index({ sessionId: 1, timestamp: 1 });
// locationSchema.index({ userId: 1, timestamp: -1 });

// module.exports = mongoose.model("Location", locationSchema);
