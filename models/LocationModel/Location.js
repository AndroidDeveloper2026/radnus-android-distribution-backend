const mongoose = require("mongoose");

const locationSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  latitude: Number,
  longitude: Number,
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Location", locationSchema);