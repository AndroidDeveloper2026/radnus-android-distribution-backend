const appVersion = require("../config/appVersion");
const { compareVersions, isValidVersion } = require("../utils/versionCompare");

const SUPPORTED_PLATFORMS = ["android", "ios"];

// GET /api/app/version?platform=android|ios&currentVersion=1.2.0
// Public (no auth) so the app can check before/without login.
const getAppVersion = (req, res) => {
  try {
    const platform = String(req.query.platform || "").toLowerCase();
    const cfg = SUPPORTED_PLATFORMS.includes(platform) ? appVersion[platform] : null;

    if (!cfg) {
      return res
        .status(400)
        .json({ message: "platform must be 'android' or 'ios'" });
    }

    const { currentVersion } = req.query;
    const known = isValidVersion(currentVersion);

    // If the app didn't tell us its version we can't judge it, so never prompt.
    const forceUpdate = known && compareVersions(currentVersion, cfg.minVersion) < 0;
    const updateAvailable =
      forceUpdate || (known && compareVersions(currentVersion, cfg.latestVersion) < 0);

    res.set("Cache-Control", "no-store");
    return res.json({
      platform,
      latestVersion: cfg.latestVersion,
      minVersion: cfg.minVersion,
      updateAvailable,
      forceUpdate,
      storeUrl: cfg.storeUrl,
      message: forceUpdate ? appVersion.forceMessage : appVersion.message,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

module.exports = { getAppVersion };
