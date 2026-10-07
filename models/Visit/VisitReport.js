
const mongoose = require("mongoose");

const visitReportSchema = new mongoose.Schema(
  {
    // ── Who submitted ──────────────────────────────────────────────
    executiveId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Register",
      required: true,
      index: true,
    },

    // ── Customer info (your field list) ────────────────────────────
    name: { type: String, required: true, trim: true },
    businessName: { type: String, required: true, trim: true },

    mobile: {
      type: String,
      required: true,
      trim: true,
      match: /^[6-9]\d{9}$/,
    },

    taluk: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true },

    // "Business" — what type of business they run
    business: { type: String, required: true, trim: true },

    // Two-field status setup:
    //   status     = the visit outcome (e.g. "Visited", "Order Placed", …)
    //   statusFlow = the pipeline bucket (Cold / Warm / Hot)
    status: {
      type: String,
      enum: ["NEW", "VISITED", "FOLLOW_UP", "ORDER_PLACED", "NOT_INTERESTED"],
      default: "VISITED",
    },

    statusFlow: {
      type: String,
      enum: ["COLD", "WARM", "HOT"],
      required: true,
    },

    // Free-text report
    report: { type: String, required: true, trim: true },

    // ── Auto-captured metadata ─────────────────────────────────────
    visitDateKey: { type: String, index: true }, // IST "YYYY-MM-DD"

    submittedAt: { type: Date, default: Date.now, index: true },

    location: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      accuracy: { type: Number, default: 0 },
    },

    // Optional links to the existing tracking / attendance flow
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      default: null,
    },
    attendanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attendance",
      default: null,
    },

    // Admin/Manager can add a note (optional — useful for supervision)
    managerNote: { type: String, default: "" },
    notedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Register",
      default: null,
    },
    notedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Common query indexes
visitReportSchema.index({ executiveId: 1, visitDateKey: -1 });
visitReportSchema.index({ visitDateKey: -1, statusFlow: 1 });
visitReportSchema.index({ district: 1, taluk: 1 });

// Auto-fill visitDateKey in IST before save if not set
visitReportSchema.pre("save", function () {
  if (!this.visitDateKey && this.submittedAt) {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const d = new Date(new Date(this.submittedAt).getTime() + IST_OFFSET_MS);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    this.visitDateKey = `${y}-${m}-${day}`;
  }
});

module.exports = mongoose.model("VisitReport", visitReportSchema);