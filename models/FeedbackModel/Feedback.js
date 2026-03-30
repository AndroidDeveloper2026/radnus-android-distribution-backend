const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema(
 {
   message: { type: String, required: true },
   user: { type: String, required: true },
   phone: String,
   status: {
     type: String,
     enum: ["PENDING", "RESOLVED"],
     default: "PENDING",
   },
 },
 { timestamps: true }
);

module.exports = mongoose.model("Feedback", feedbackSchema);