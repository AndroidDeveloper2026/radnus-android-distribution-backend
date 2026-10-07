const mongoose = require("mongoose");
const VisitReport = require("../models/Visit/VisitReport");
const Register = require("../models/Register");
const Session = require("../models/FSEModel/Session");
const Attendance = require("../models/Attendance/Attendance");
const { canViewUser, getSubordinateIds } = require("../utils/hierarchyScope");
const { istDateKey } = require("../services/attendanceService");
const { normKey } = require("../utils/visitKeys");

const ADMIN_LIKE = ["Admin"];

// ── Revisit helper ────────────────────────────────────────────────
// A report is a REVISIT when an EARLIER report exists with the same
// mobile OR the same (normalised) shop name. Customer name alone is too
// common ("Kumar") so it is only used as a soft hint in the create form.
// Computed from the data → no backfill of counters, deletes renumber.
const attachVisitCounts = async (items) => {
  const list = (Array.isArray(items) ? items : [items]).filter(Boolean);
  if (!list.length) return items;

  const keyOf = (r) => r.businessKey || normKey(r.businessName);
  const mobiles = [...new Set(list.map((i) => i.mobile).filter(Boolean))];
  const bkeys = [...new Set(list.map(keyOf).filter(Boolean))];

  const or = [];
  if (mobiles.length) or.push({ mobile: { $in: mobiles } });
  if (bkeys.length) or.push({ businessKey: { $in: bkeys } });
  if (!or.length) return items;

  const rows = await VisitReport.find({ $or: or })
    .select("mobile businessKey businessName submittedAt")
    .lean();

  const isBefore = (a, b) => {
    const ta = new Date(a.submittedAt).getTime();
    const tb = new Date(b.submittedAt).getTime();
    return ta !== tb ? ta < tb : String(a._id) < String(b._id);
  };

  const decorate = (it) => {
    const k = keyOf(it);
    const matches = rows.filter(
      (r) =>
        String(r._id) !== String(it._id) &&
        ((it.mobile && r.mobile === it.mobile) || (k && keyOf(r) === k))
    );
    const earlier = matches.filter((r) => isBefore(r, it));
    const matchedOn = [];
    if (earlier.some((r) => r.mobile === it.mobile)) matchedOn.push("mobile");
    if (k && earlier.some((r) => keyOf(r) === k)) matchedOn.push("shop");
    return {
      ...it,
      visitNumber: earlier.length + 1,
      totalVisits: matches.length + 1,
      isRevisit: earlier.length > 0,
      matchedOn,
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

    // ── Who is submitting (snapshot stored on the report) ─────────
    let submitter = null;
    try {
      submitter = await Register.findById(executiveId)
        .select("name role mobile")
        .lean();
    } catch (_) {}

    // ── Create ────────────────────────────────────────────────────
    const doc = await VisitReport.create({
      executiveId,
      executiveName: submitter?.name || req.user.name || "",
      executiveRole: submitter?.role || req.user.role || "",
      executiveMobile: submitter?.mobile || "",
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
//  CHECK DUPLICATE — GET /api/visit-reports/check-duplicate
//     ?mobile=&name=&businessName=
//  Each field is checked INDEPENDENTLY so the form can say exactly
//  what already exists, and which executive / manager visited before.
// ═════════════════════════════════════════════════════════════════
exports.checkDuplicate = async (req, res) => {
  try {
    const mobile = String(req.query.mobile || "").trim();
    const nameKey = normKey(req.query.name);
    const businessKey = normKey(req.query.businessName);

    const useMobile = /^[6-9]\d{9}$/.test(mobile);
    const useName = nameKey.length >= 3;
    const useShop = businessKey.length >= 3;

    const empty = {
      success: true,
      matches: { mobile: 0, name: 0, businessName: 0 },
      visits: [],
    };

    const or = [];
    if (useMobile) or.push({ mobile });
    if (useName) or.push({ nameKey });
    if (useShop) or.push({ businessKey });
    if (!or.length) return res.json(empty);

    const rows = await VisitReport.find({ $or: or })
      .sort({ submittedAt: -1 })
      .limit(200)
      .populate("executiveId", "name role")
      .select(
        "name businessName mobile nameKey businessKey statusFlow submittedAt executiveId executiveName executiveRole taluk district"
      )
      .lean();

    const hit = (r) => ({
      mobile: useMobile && r.mobile === mobile,
      name: useName && (r.nameKey || normKey(r.name)) === nameKey,
      businessName:
        useShop && (r.businessKey || normKey(r.businessName)) === businessKey,
    });

    const matches = { mobile: 0, name: 0, businessName: 0 };
    rows.forEach((r) => {
      const h = hit(r);
      if (h.mobile) matches.mobile++;
      if (h.name) matches.name++;
      if (h.businessName) matches.businessName++;
    });

    const visits = rows.slice(0, 5).map((r) => {
      const h = hit(r);
      return {
        _id: r._id,
        name: r.name,
        businessName: r.businessName,
        taluk: r.taluk,
        district: r.district,
        statusFlow: r.statusFlow,
        submittedAt: r.submittedAt,
        visitedBy: r.executiveName || r.executiveId?.name || null,
        visitedByRole: r.executiveRole || r.executiveId?.role || null,
        byMe: String(r.executiveId?._id || r.executiveId) === String(req.user.id),
        matchedOn: [
          h.mobile && "mobile",
          h.name && "name",
          h.businessName && "shop",
        ].filter(Boolean),
      };
    });

    return res.json({ success: true, matches, visits });
  } catch (err) {
    console.error("checkDuplicate:", err);
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