// const mongoose = require("mongoose");

// const locationSchema = new mongoose.Schema({

//   userId: String,

//   sessionId: String,

//   latitude: Number,

//   longitude: Number,

//   timestamp: {
//     type: Date,
//     default: Date.now
//   }

// });

// module.exports = mongoose.model("Location", locationSchema);


const mongoose = require("mongoose");

const locationSchema = new mongoose.Schema({
 userId: {
   type: String,
   required: true
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
   default: Date.now
 }
});

locationSchema.index({ sessionId: 1, timestamp: 1 });

module.exports = mongoose.model("Location", locationSchema)
