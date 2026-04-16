const ActivityLog = require("../models/ActivityLog");
const Register = require("../models/Register");

const createActivityLog = async (req, res) => {
  try {
    const { action, productId, productName } = req.body;

    // ✅ Fetch user from DB
    const dbUser = await Register.findById(req.user.id);

    if (!dbUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const log = await ActivityLog.create({
      action,
      productId,
      productName,
      user: dbUser.name,   // ✅ FIXED
      role: dbUser.role,
    });

    res.status(201).json(log);
  } catch (err) {
    console.error("LOG ERROR:", err);
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