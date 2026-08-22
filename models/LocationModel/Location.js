const mongoose = require("mongoose");

const locationSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true  // ✅ Regular index, NOT unique
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
  accuracy: {
    type: Number,
    default: 0
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
}, { timestamps: true });

// ✅ CORRECT: Compound index for performance (NOT unique)
locationSchema.index({ userId: 1, sessionId: 1, timestamp: -1 });
locationSchema.index({ sessionId: 1, timestamp: -1 });

module.exports = mongoose.model("Location", locationSchema);

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
