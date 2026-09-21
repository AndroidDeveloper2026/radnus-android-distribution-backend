const express = require("express");
const router = express.Router();

const { getAppVersion } = require("../controllers/appVersionController");

// Public: no auth middleware on purpose.
router.get("/version", getAppVersion);

module.exports = router;
