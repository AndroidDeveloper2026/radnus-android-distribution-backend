const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const ctrl = require("../controllers/visitReportController");

router.use(auth); // JWT for every route

// Self service
router.post("/", ctrl.createVisitReport);
router.get("/my-history", ctrl.getMyHistory);

// Admin / Manager
router.get("/", ctrl.listVisitReports);
router.get("/summary", ctrl.getSummary);
router.get("/executive-summary", ctrl.getExecutiveSummary);
router.get("/check-duplicate", ctrl.checkDuplicate);

// Detail / edit / delete
router.get("/:id", ctrl.getVisitReportById);
router.put("/:id", ctrl.updateVisitReport);
router.delete("/:id", ctrl.deleteVisitReport);

module.exports = router;