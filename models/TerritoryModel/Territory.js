const mongoose = require('mongoose');

const territorySchema = new mongoose.Schema({
  state: String,
  district: String,
  taluk: String,
  beats: [String],
  assignedTo: String,
  active: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true });

module.exports = mongoose.model('Territory', territorySchema);
