const mongoose = require("mongoose");

const fseDaySchema = new mongoose.Schema({
  fseId: { type: mongoose.Schema.Types.ObjectId, required: true },
  date: { type: String, required: true }, // YYYY-MM-DD

  startTime: Date,
  endTime: Date,

  endType: {
    type: String,
    enum: ["MANUAL", "AUTO"],
  },

  status: {
    type: String,
    enum: ["STARTED", "ENDED"],
    default: "STARTED",
  },
}, { timestamps: true });

module.exports = mongoose.model("FSEDay", fseDaySchema);
