const ActivityLog = require("../models/ActivityLog");

// CREATE LOG
const createActivityLog = async (req, res) => {
  try {
    const { action, productId, productName } = req.body;

    const log = await ActivityLog.create({
      action,
      productId,
      productName,
      user: req.user.name,
      role: req.user.role,
    });

    res.status(201).json(log);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET LOGS (ADMIN)
const getActivityLogs = async (req, res) => {
  try {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const logs = await ActivityLog.find().sort({ timestamp: -1 });

    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createActivityLog,
  getActivityLogs,
};