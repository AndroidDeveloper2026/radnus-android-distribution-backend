
/**
 * models/FSEModel/Session.js
 *
 * One document per FSE work-day session.
 *
 * The `route` array is a *denormalised snapshot* rebuilt from the Location
 * collection every REBUILD_EVERY_N points (see locationRoutes.js) and also
 * once more on session end.  It allows fast map rendering without a full
 * Location collection scan on every GET request.
 *
 * The canonical distance / point count always comes from this snapshot after
 * a rebuild; the incremental $inc values are an approximation used to answer
 * socket broadcasts instantly without waiting for the rebuild.
 */

'use strict';

const mongoose = require('mongoose');

const routePointSchema = new mongoose.Schema(
  {
    latitude:  { type: Number, required: true },
    longitude: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
);

const sessionSchema = new mongoose.Schema(
  {
    userId: {
      type:     String,
      required: true,
      index:    true,
    },

    startLocation: {
      latitude:  Number,
      longitude: Number,
    },

    // Denormalised route snapshot — rebuilt from Location docs periodically.
    route: {
      type:    [routePointSchema],
      default: [],
    },

    // Running total in km — kept in sync with $inc on every accepted point
    // and corrected to 4 dp on every rebuild.
    totalDistanceKm: {
      type:    Number,
      default: 0,
    },

    // Denormalised count so list-views don't need to project the route array.
    pointCount: {
      type:    Number,
      default: 0,
    },

    startTime: {
      type:    Date,
      default: Date.now,
      index:   true,
    },

    endTime: {
      type: Date,
    },

    status: {
      type:    String,
      enum:    ['ACTIVE', 'ENDED', 'AUTO_ENDED'],
      default: 'ACTIVE',
      index:   true,
    },

    metadata: {
      deviceInfo: String,
      appVersion: String,
    },
  },
  { timestamps: true },
);

// Compound index: look up today's active session for a user in one scan.
sessionSchema.index({ userId: 1, status: 1, startTime: -1 });

module.exports = mongoose.model('Session', sessionSchema);

//------- 6.8.26 ------------------------
// const mongoose = require("mongoose");

// const sessionSchema = new mongoose.Schema({

//   userId: {
//     type: String,
//     required: true,
//     index: true
//   },

//   startLocation: {
//     latitude: Number,
//     longitude: Number
//   },

//   // Store all GPS coordinates for the route
//   route: [
//     {
//       latitude: Number,
//       longitude: Number,
//       timestamp: { 
//         type: Date, 
//         default: Date.now 
//       }
//     }
//   ],

//   // Total distance traveled in kilometers
//   totalDistanceKm: {
//     type: Number,
//     default: 0
//   },

//   // Session start time
//   startTime: {
//     type: Date,
//     default: Date.now,
//     index: true
//   },

//   // Session end time
//   endTime: Date,

//   // Session status
//   status: {
//     type: String,
//     enum: ["ACTIVE", "ENDED", "AUTO_ENDED"],
//     default: "ACTIVE",
//     index: true
//   },

//   // Additional metadata
//   metadata: {
//     deviceInfo: String,
//     appVersion: String,
//   }

// }, { timestamps: true });

// module.exports = mongoose.model("Session", sessionSchema);
