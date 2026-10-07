const mongoose = require("mongoose");
const VisitReport = require("../models/Visit/VisitReport");
const Register = require("../models/Register");
const Session = require("../models/FSEModel/Session");
const Attendance = require("../models/Attendance/Attendance");
const { canViewUser, getSubordinateIds } = require("../utils/hierarchyScope");
const { istDateKey } = require("../services/attendanceService");

const ADMIN_LIKE = ["Admin"];

// ── Revisit helper ────────────────────────────────────────────────
// Visit number is computed from the data (no stored field, no backfill):
// the Nth report ever submitted for the same customer mobile = "visit N".
const attachVisitCounts = async (items) => {
  const list = Array.isArray(items) ? items : [items];
  const mobiles = [...new Set(list.map((i) => i && i.mobile).filter(Boolean))];
  if (!mobiles.length) return items;

  const rows = await VisitReport.find({ mobile: { $in: mobiles } })
    .select("mobile submittedAt")
    .sort({ submittedAt: 1, _id: 1 })
    .lean();

  const byMobile = {};
  rows.forEach((r) => {
    (byMobile[r.mobile] = byMobile[r.mobile] || []).push(String(r._id));
  });

  const decorate = (it) => {
    const ids = byMobile[it.mobile] || [];
    const idx = ids.indexOf(String(it._id));
    return {
      ...it,
      visitNumber: idx >= 0 ? idx + 1 : ids.length || 1,
      totalVisits: ids.length || 1,
      isRevisit: (idx >= 0 ? idx + 1 : ids.length) > 1,
    };
  };

  return Array.isArray(items) ? list.map(decorate) : decorate(items);
};

// ── Helper ────────────────────────────────────────────────────────
const pickLocation = (body) => {
  if (!body) return { latitude: null, longitude: null, accuracy: 0 };
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng))
    return { latitude: null, longitude: null, accuracy: 0 };
  return { latitude: lat, longitude: lng, accuracy: Number(body.accuracy) || 0 };
};

// ═════════════════════════════════════════════════════════════════
//  CREATE  — POST /api/visit-reports
// ═════════════════════════════════════════════════════════════════
exports.createVisitReport = async (req, res) => {
  try {
    const executiveId = req.user.id; // NEVER trust body

    const {
      name,
      businessName,
      mobile,
      taluk,
      district,
      business,
      status,
      statusFlow,
      report,
      // location is in req.body but read explicitly for clarity
      latitude,
      longitude,
      accuracy,
    } = req.body;

    // ── Validation ────────────────────────────────────────────────
    const missing = [];
    if (!name?.trim()) missing.push("name");
    if (!businessName?.trim()) missing.push("businessName");
    if (!mobile?.trim()) missing.push("mobile");
    if (!taluk?.trim()) missing.push("taluk");
    if (!district?.trim()) missing.push("district");
    if (!business?.trim()) missing.push("business");
    if (!statusFlow?.trim()) missing.push("statusFlow");
    if (!report?.trim()) missing.push("report");

    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(", ")}`,
      });
    }

    if (!/^[6-9]\d{9}$/.test(String(mobile).trim())) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid mobile number" });
    }

    if (!["COLD", "WARM", "HOT"].includes(statusFlow)) {
      return res
        .status(400)
        .json({ success: false, message: "statusFlow must be COLD, WARM or HOT" });
    }

    // ── Auto-link to today's session + attendance (best-effort) ───
    const today = istDateKey();
    const [activeSession, todayAttendance] = await Promise.all([
      Session.findOne({
        userId: String(executiveId),
        status: { $in: ["ACTIVE", "AUTO_ENDED"] },
      })
        .sort({ startTime: -1 })
        .select("_id")
        .lean(),
      Attendance.findOne({ employeeId: executiveId, date: today })
        .select("_id")
        .lean(),
    ]);

    // ── Create ────────────────────────────────────────────────────
    const doc = await VisitReport.create({
      executiveId,
      name: name.trim(),
      businessName: businessName.trim(),
      mobile: String(mobile).trim(),
      taluk: taluk.trim(),
      district: district.trim(),
      business: business.trim(),
      status: status || "VISITED",
      statusFlow,
      report: report.trim(),
      submittedAt: new Date(),
      visitDateKey: today,
      location: pickLocation({ latitude, longitude, accuracy }),
      sessionId: activeSession?._id || null,
      attendanceId: todayAttendance?._id || null,
    });

    // Populate the executive (so the UI shows the author's name)
    await doc.populate("executiveId", "name role photo district taluk");

    const decorated = await attachVisitCounts(doc.toObject());
    return res.status(201).json({ success: true, report: decorated });
  } catch (err) {
    console.error("createVisitReport:", err);
    return res
      .status(500)
      .json({ success: false, message: err.message || "Server error" });
  }
};

// ═════════════════════════════════════════════════════════════════
//  MY HISTORY  — GET /api/visit-reports/my-history?from=&to=&page=
// ═════════════════════════════════════════════════════════════════
exports.getMyHistory = async (req, res) => {
  try {
    const { from, to, page = 1, limit = 30, statusFlow, search } = req.query;
    const q = { executiveId: req.user.id };

    if (from || to) {
      q.visitDateKey = {};
      if (from) q.visitDateKey.$gte = from;
      if (to) q.visitDateKey.$lte = to;
    }
    if (statusFlow) q.statusFlow = statusFlow;

    if (search && search.trim()) {
      const rx = new RegExp(
        search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      q.$or = [
        { name: rx },
        { businessName: rx },
        { mobile: rx },
        { taluk: rx },
        { district: rx },
      ];
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [items, total] = await Promise.all([
      VisitReport.find(q)
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .lean(),
      VisitReport.countDocuments(q),
    ]);

    const decoratedItems = await attachVisitCounts(items);

    return res.json({
      success: true,
      items: decoratedItems,
      total,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / parseInt(limit, 10)),
    });
  } catch (err) {
    console.error("getMyHistory:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════
//  GET ONE  — GET /api/visit-reports/:id
// ═════════════════════════════════════════════════════════════════
exports.getVisitReportById = async (req, res) => {
  try {
    const doc = await VisitReport.findById(req.params.id)
      .populate("executiveId", "name role photo district taluk mobile")
      .populate("notedBy", "name role");

    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: "Report not found" });
    }

    // Permission: author, their superiors, or Admin
    const isAuthor = String(doc.executiveId?._id) === String(req.user.id);
    const isAdmin = ADMIN_LIKE.includes(req.user.role);
    const isSuperior = await canViewUser(req.user, doc.executiveId?._id);

    if (!isAuthor && !isAdmin && !isSuperior) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    const decorated = await attachVisitCounts(doc.toObject());
    return res.json({ success: true, report: decorated });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════
//  CHECK MOBILE — GET /api/visit-reports/check-mobile/:mobile
//  Used by the create form: "this customer was already visited N times".
// ═════════════════════════════════════════════════════════════════
exports.checkMobile = async (req, res) => {
  try {
    const mobile = String(req.params.mobile || "").trim();
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      return res.json({ success: true, count: 0, lastVisit: null });
    }

    const [count, last] = await Promise.all([
      VisitReport.countDocuments({ mobile }),
      VisitReport.findOne({ mobile })
        .sort({ submittedAt: -1 })
        .populate("executiveId", "name")
        .select("name businessName submittedAt statusFlow executiveId")
        .lean(),
    ]);

    return res.json({
      success: true,
      count,
      lastVisit: last
        ? {
            name: last.name,
            businessName: last.businessName,
            submittedAt: last.submittedAt,
            statusFlow: last.statusFlow,
            visitedBy: last.executiveId?.name || null,
            byMe: String(last.executiveId?._id) === String(req.user.id),
          }
        : null,
    });
  } catch (err) {
    console.error("checkMobile:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════
//  LIST  — GET /api/visit-reports?date=&executiveId=&statusFlow=&search=&page=&limit=
//  Admin / Manager team view.
// ═════════════════════════════════════════════════════════════════
exports.listVisitReports = async (req, res) => {
  try {
    const {
      date,
      from,
      to,
      executiveId,
      statusFlow,
      district,
      taluk,
      search,
      page = 1,
      limit = 50,
    } = req.query;

    const user = req.user;

    // ── Scope: Admin sees all; Managers/Executives see team below ─
    let scopeIds = null;
    if (!ADMIN_LIKE.includes(user.role)) {
      const subIds = await getSubordinateIds(user);
      scopeIds = [String(user.id), ...subIds];
    }

    const q = {};
    if (date) q.visitDateKey = date;
    else if (from || to) {
      q.visitDateKey = {};
      if (from) q.visitDateKey.$gte = from;
      if (to) q.visitDateKey.$lte = to;
    }
    if (statusFlow) q.statusFlow = statusFlow;
    if (district) q.district = district;
    if (taluk) q.taluk = taluk;

    if (executiveId) {
      // Explicit filter — must be within scope
      if (scopeIds && !scopeIds.includes(String(executiveId))) {
        return res
          .status(403)
          .json({ success: false, message: "Not authorized" });
      }
      q.executiveId = new mongoose.Types.ObjectId(executiveId);
    } else if (scopeIds) {
      q.executiveId = {
        $in: scopeIds.map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    if (search && search.trim()) {
      const rx = new RegExp(
        search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      const or = [
        { name: rx },
        { businessName: rx },
        { mobile: rx },
        { taluk: rx },
        { district: rx },
      ];
      if (q.$or) q.$and = [{ $or: q.$or }, { $or: or }];
      else q.$or = or;
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [items, total] = await Promise.all([
      VisitReport.find(q)
        .populate("executiveId", "name role photo district taluk")
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .lean(),
      VisitReport.countDocuments(q),
    ]);

    const decoratedItems = await attachVisitCounts(items);

    return res.json({
      success: true,
      items: decoratedItems,
      total,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / parseInt(limit, 10)),
    });
  } catch (err) {
    console.error("listVisitReports:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════
//  SUMMARY  — GET /api/visit-reports/summary?date=
//  Returns counts by statusFlow for a day (Admin/Manager dashboard).
// ═════════════════════════════════════════════════════════════════
exports.getSummary = async (req, res) => {
  try {
    const date = req.query.date || istDateKey();
    const user = req.user;

    const match = { visitDateKey: date };

    if (!ADMIN_LIKE.includes(user.role)) {
      const subIds = await getSubordinateIds(user);
      const scopeIds = [String(user.id), ...subIds];
      match.executiveId = {
        $in: scopeIds.map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    const raw = await VisitReport.aggregate([
      { $match: match },
      { $group: { _id: "$statusFlow", count: { $sum: 1 } } },
    ]);

    const summary = { COLD: 0, WARM: 0, HOT: 0, TOTAL: 0 };
    raw.forEach((r) => {
      if (r._id in summary) summary[r._id] = r.count;
      summary.TOTAL += r.count;
    });

    return res.json({ success: true, date, summary });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════
//  UPDATE  — PUT /api/visit-reports/:id
//  Only author OR Admin can edit. Managers may only add a note.
// ═════════════════════════════════════════════════════════════════
exports.updateVisitReport = async (req, res) => {
  try {
    const doc = await VisitReport.findById(req.params.id);
    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: "Report not found" });
    }

    const isAuthor = String(doc.executiveId) === String(req.user.id);
    const isAdmin = ADMIN_LIKE.includes(req.user.role);
    const isSuperior = await canViewUser(req.user, doc.executiveId);

    if (!isAuthor && !isAdmin && !isSuperior) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    // Managers (non-author, non-admin) can only add a note
    if (!isAuthor && !isAdmin) {
      if (req.body.managerNote !== undefined) {
        doc.managerNote = String(req.body.managerNote).trim();
        doc.notedBy = req.user.id;
        doc.notedAt = new Date();
        await doc.save();
        await doc.populate("executiveId", "name role photo");
        await doc.populate("notedBy", "name role");
        return res.json({
          success: true,
          report: await attachVisitCounts(doc.toObject()),
        });
      }
      return res.status(403).json({
        success: false,
        message: "Managers can only add a note to the report",
      });
    }

    // Author or Admin: full editable fields
    const editable = [
      "name",
      "businessName",
      "mobile",
      "taluk",
      "district",
      "business",
      "status",
      "statusFlow",
      "report",
      "managerNote",
    ];
    editable.forEach((k) => {
      if (req.body[k] !== undefined) doc[k] = req.body[k];
    });

    if (req.body.latitude !== undefined || req.body.longitude !== undefined) {
      doc.location = pickLocation(req.body);
    }

    if (!["COLD", "WARM", "HOT"].includes(doc.statusFlow)) {
      return res
        .status(400)
        .json({ success: false, message: "statusFlow must be COLD, WARM or HOT" });
    }

    await doc.save();
    await doc.populate("executiveId", "name role photo");
    return res.json({
          success: true,
          report: await attachVisitCounts(doc.toObject()),
        });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════
//  DELETE  — DELETE /api/visit-reports/:id
//  Author OR Admin only.
// ═════════════════════════════════════════════════════════════════
exports.deleteVisitReport = async (req, res) => {
  try {
    const doc = await VisitReport.findById(req.params.id);
    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: "Report not found" });
    }

    const isAuthor = String(doc.executiveId) === String(req.user.id);
    const isAdmin = ADMIN_LIKE.includes(req.user.role);

    if (!isAuthor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Only the author or Admin can delete this report",
      });
    }

    await doc.deleteOne();
    return res.json({ success: true, message: "Report deleted" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

//---------------- 07.10.26 ----------------------------------
// const mongoose = require("mongoose");
// const VisitReport = require("../models/Visit/VisitReport");
// const Register = require("../models/Register");
// const Session = require("../models/FSEModel/Session");
// const Attendance = require("../models/Attendance/Attendance");
// const { canViewUser, getSubordinateIds } = require("../utils/hierarchyScope");
// const { istDateKey } = require("../services/attendanceService");

// const ADMIN_LIKE = ["Admin"];

// // ── Helper ────────────────────────────────────────────────────────
// const pickLocation = (body) => {
//   if (!body) return { latitude: null, longitude: null, accuracy: 0 };
//   const lat = Number(body.latitude);
//   const lng = Number(body.longitude);
//   if (Number.isNaN(lat) || Number.isNaN(lng))
//     return { latitude: null, longitude: null, accuracy: 0 };
//   return { latitude: lat, longitude: lng, accuracy: Number(body.accuracy) || 0 };
// };

// // ═════════════════════════════════════════════════════════════════
// //  CREATE  — POST /api/visit-reports
// // ═════════════════════════════════════════════════════════════════
// exports.createVisitReport = async (req, res) => {
//   try {
//     const executiveId = req.user.id; // NEVER trust body

//     const {
//       name,
//       businessName,
//       mobile,
//       taluk,
//       district,
//       business,
//       status,
//       statusFlow,
//       report,
//       // location is in req.body but read explicitly for clarity
//       latitude,
//       longitude,
//       accuracy,
//     } = req.body;

//     // ── Validation ────────────────────────────────────────────────
//     const missing = [];
//     if (!name?.trim()) missing.push("name");
//     if (!businessName?.trim()) missing.push("businessName");
//     if (!mobile?.trim()) missing.push("mobile");
//     if (!taluk?.trim()) missing.push("taluk");
//     if (!district?.trim()) missing.push("district");
//     if (!business?.trim()) missing.push("business");
//     if (!statusFlow?.trim()) missing.push("statusFlow");
//     if (!report?.trim()) missing.push("report");

//     if (missing.length) {
//       return res.status(400).json({
//         success: false,
//         message: `Missing required fields: ${missing.join(", ")}`,
//       });
//     }

//     if (!/^[6-9]\d{9}$/.test(String(mobile).trim())) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid mobile number" });
//     }

//     if (!["COLD", "WARM", "HOT"].includes(statusFlow)) {
//       return res
//         .status(400)
//         .json({ success: false, message: "statusFlow must be COLD, WARM or HOT" });
//     }

//     // ── Auto-link to today's session + attendance (best-effort) ───
//     const today = istDateKey();
//     const [activeSession, todayAttendance] = await Promise.all([
//       Session.findOne({
//         userId: String(executiveId),
//         status: { $in: ["ACTIVE", "AUTO_ENDED"] },
//       })
//         .sort({ startTime: -1 })
//         .select("_id")
//         .lean(),
//       Attendance.findOne({ employeeId: executiveId, date: today })
//         .select("_id")
//         .lean(),
//     ]);

//     // ── Create ────────────────────────────────────────────────────
//     const doc = await VisitReport.create({
//       executiveId,
//       name: name.trim(),
//       businessName: businessName.trim(),
//       mobile: String(mobile).trim(),
//       taluk: taluk.trim(),
//       district: district.trim(),
//       business: business.trim(),
//       status: status || "VISITED",
//       statusFlow,
//       report: report.trim(),
//       submittedAt: new Date(),
//       visitDateKey: today,
//       location: pickLocation({ latitude, longitude, accuracy }),
//       sessionId: activeSession?._id || null,
//       attendanceId: todayAttendance?._id || null,
//     });

//     // Populate the executive (so the UI shows the author's name)
//     await doc.populate("executiveId", "name role photo district taluk");

//     return res.status(201).json({ success: true, report: doc });
//   } catch (err) {
//     console.error("createVisitReport:", err);
//     return res
//       .status(500)
//       .json({ success: false, message: err.message || "Server error" });
//   }
// };

// // ═════════════════════════════════════════════════════════════════
// //  MY HISTORY  — GET /api/visit-reports/my-history?from=&to=&page=
// // ═════════════════════════════════════════════════════════════════
// exports.getMyHistory = async (req, res) => {
//   try {
//     const { from, to, page = 1, limit = 30, statusFlow, search } = req.query;
//     const q = { executiveId: req.user.id };

//     if (from || to) {
//       q.visitDateKey = {};
//       if (from) q.visitDateKey.$gte = from;
//       if (to) q.visitDateKey.$lte = to;
//     }
//     if (statusFlow) q.statusFlow = statusFlow;

//     if (search && search.trim()) {
//       const rx = new RegExp(
//         search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
//         "i"
//       );
//       q.$or = [
//         { name: rx },
//         { businessName: rx },
//         { mobile: rx },
//         { taluk: rx },
//         { district: rx },
//       ];
//     }

//     const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
//     const [items, total] = await Promise.all([
//       VisitReport.find(q)
//         .sort({ submittedAt: -1 })
//         .skip(skip)
//         .limit(parseInt(limit, 10))
//         .lean(),
//       VisitReport.countDocuments(q),
//     ]);

//     return res.json({
//       success: true,
//       items,
//       total,
//       page: parseInt(page, 10),
//       totalPages: Math.ceil(total / parseInt(limit, 10)),
//     });
//   } catch (err) {
//     console.error("getMyHistory:", err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// // ═════════════════════════════════════════════════════════════════
// //  GET ONE  — GET /api/visit-reports/:id
// // ═════════════════════════════════════════════════════════════════
// exports.getVisitReportById = async (req, res) => {
//   try {
//     const doc = await VisitReport.findById(req.params.id)
//       .populate("executiveId", "name role photo district taluk mobile")
//       .populate("notedBy", "name role");

//     if (!doc) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Report not found" });
//     }

//     // Permission: author, their superiors, or Admin
//     const isAuthor = String(doc.executiveId?._id) === String(req.user.id);
//     const isAdmin = ADMIN_LIKE.includes(req.user.role);
//     const isSuperior = await canViewUser(req.user, doc.executiveId?._id);

//     if (!isAuthor && !isAdmin && !isSuperior) {
//       return res
//         .status(403)
//         .json({ success: false, message: "Not authorized" });
//     }

//     return res.json({ success: true, report: doc });
//   } catch (err) {
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// // ═════════════════════════════════════════════════════════════════
// //  LIST  — GET /api/visit-reports?date=&executiveId=&statusFlow=&search=&page=&limit=
// //  Admin / Manager team view.
// // ═════════════════════════════════════════════════════════════════
// exports.listVisitReports = async (req, res) => {
//   try {
//     const {
//       date,
//       from,
//       to,
//       executiveId,
//       statusFlow,
//       district,
//       taluk,
//       search,
//       page = 1,
//       limit = 50,
//     } = req.query;

//     const user = req.user;

//     // ── Scope: Admin sees all; Managers/Executives see team below ─
//     let scopeIds = null;
//     if (!ADMIN_LIKE.includes(user.role)) {
//       const subIds = await getSubordinateIds(user);
//       scopeIds = [String(user.id), ...subIds];
//     }

//     const q = {};
//     if (date) q.visitDateKey = date;
//     else if (from || to) {
//       q.visitDateKey = {};
//       if (from) q.visitDateKey.$gte = from;
//       if (to) q.visitDateKey.$lte = to;
//     }
//     if (statusFlow) q.statusFlow = statusFlow;
//     if (district) q.district = district;
//     if (taluk) q.taluk = taluk;

//     if (executiveId) {
//       // Explicit filter — must be within scope
//       if (scopeIds && !scopeIds.includes(String(executiveId))) {
//         return res
//           .status(403)
//           .json({ success: false, message: "Not authorized" });
//       }
//       q.executiveId = new mongoose.Types.ObjectId(executiveId);
//     } else if (scopeIds) {
//       q.executiveId = {
//         $in: scopeIds.map((id) => new mongoose.Types.ObjectId(id)),
//       };
//     }

//     if (search && search.trim()) {
//       const rx = new RegExp(
//         search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
//         "i"
//       );
//       const or = [
//         { name: rx },
//         { businessName: rx },
//         { mobile: rx },
//         { taluk: rx },
//         { district: rx },
//       ];
//       if (q.$or) q.$and = [{ $or: q.$or }, { $or: or }];
//       else q.$or = or;
//     }

//     const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
//     const [items, total] = await Promise.all([
//       VisitReport.find(q)
//         .populate("executiveId", "name role photo district taluk")
//         .sort({ submittedAt: -1 })
//         .skip(skip)
//         .limit(parseInt(limit, 10))
//         .lean(),
//       VisitReport.countDocuments(q),
//     ]);

//     return res.json({
//       success: true,
//       items,
//       total,
//       page: parseInt(page, 10),
//       totalPages: Math.ceil(total / parseInt(limit, 10)),
//     });
//   } catch (err) {
//     console.error("listVisitReports:", err);
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// // ═════════════════════════════════════════════════════════════════
// //  SUMMARY  — GET /api/visit-reports/summary?date=
// //  Returns counts by statusFlow for a day (Admin/Manager dashboard).
// // ═════════════════════════════════════════════════════════════════
// exports.getSummary = async (req, res) => {
//   try {
//     const date = req.query.date || istDateKey();
//     const user = req.user;

//     const match = { visitDateKey: date };

//     if (!ADMIN_LIKE.includes(user.role)) {
//       const subIds = await getSubordinateIds(user);
//       const scopeIds = [String(user.id), ...subIds];
//       match.executiveId = {
//         $in: scopeIds.map((id) => new mongoose.Types.ObjectId(id)),
//       };
//     }

//     const raw = await VisitReport.aggregate([
//       { $match: match },
//       { $group: { _id: "$statusFlow", count: { $sum: 1 } } },
//     ]);

//     const summary = { COLD: 0, WARM: 0, HOT: 0, TOTAL: 0 };
//     raw.forEach((r) => {
//       if (r._id in summary) summary[r._id] = r.count;
//       summary.TOTAL += r.count;
//     });

//     return res.json({ success: true, date, summary });
//   } catch (err) {
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// // ═════════════════════════════════════════════════════════════════
// //  UPDATE  — PUT /api/visit-reports/:id
// //  Only author OR Admin can edit. Managers may only add a note.
// // ═════════════════════════════════════════════════════════════════
// exports.updateVisitReport = async (req, res) => {
//   try {
//     const doc = await VisitReport.findById(req.params.id);
//     if (!doc) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Report not found" });
//     }

//     const isAuthor = String(doc.executiveId) === String(req.user.id);
//     const isAdmin = ADMIN_LIKE.includes(req.user.role);
//     const isSuperior = await canViewUser(req.user, doc.executiveId);

//     if (!isAuthor && !isAdmin && !isSuperior) {
//       return res
//         .status(403)
//         .json({ success: false, message: "Not authorized" });
//     }

//     // Managers (non-author, non-admin) can only add a note
//     if (!isAuthor && !isAdmin) {
//       if (req.body.managerNote !== undefined) {
//         doc.managerNote = String(req.body.managerNote).trim();
//         doc.notedBy = req.user.id;
//         doc.notedAt = new Date();
//         await doc.save();
//         await doc.populate("executiveId", "name role photo");
//         await doc.populate("notedBy", "name role");
//         return res.json({ success: true, report: doc });
//       }
//       return res.status(403).json({
//         success: false,
//         message: "Managers can only add a note to the report",
//       });
//     }

//     // Author or Admin: full editable fields
//     const editable = [
//       "name",
//       "businessName",
//       "mobile",
//       "taluk",
//       "district",
//       "business",
//       "status",
//       "statusFlow",
//       "report",
//       "managerNote",
//     ];
//     editable.forEach((k) => {
//       if (req.body[k] !== undefined) doc[k] = req.body[k];
//     });

//     if (req.body.latitude !== undefined || req.body.longitude !== undefined) {
//       doc.location = pickLocation(req.body);
//     }

//     if (!["COLD", "WARM", "HOT"].includes(doc.statusFlow)) {
//       return res
//         .status(400)
//         .json({ success: false, message: "statusFlow must be COLD, WARM or HOT" });
//     }

//     await doc.save();
//     await doc.populate("executiveId", "name role photo");
//     return res.json({ success: true, report: doc });
//   } catch (err) {
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };

// // ═════════════════════════════════════════════════════════════════
// //  DELETE  — DELETE /api/visit-reports/:id
// //  Author OR Admin only.
// // ═════════════════════════════════════════════════════════════════
// exports.deleteVisitReport = async (req, res) => {
//   try {
//     const doc = await VisitReport.findById(req.params.id);
//     if (!doc) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Report not found" });
//     }

//     const isAuthor = String(doc.executiveId) === String(req.user.id);
//     const isAdmin = ADMIN_LIKE.includes(req.user.role);

//     if (!isAuthor && !isAdmin) {
//       return res.status(403).json({
//         success: false,
//         message: "Only the author or Admin can delete this report",
//       });
//     }

//     await doc.deleteOne();
//     return res.json({ success: true, message: "Report deleted" });
//   } catch (err) {
//     return res.status(500).json({ success: false, message: err.message });
//   }
// };