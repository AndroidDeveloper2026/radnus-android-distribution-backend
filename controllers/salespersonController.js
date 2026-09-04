const Salesperson = require("../models/Salesperson");

// ─── Get all active salespersons ───────────────────────────────────────
exports.getSalespersons = async (req, res) => {
  try {
    const salespersons = await Salesperson.find({ isActive: true })
      .sort({ name: 1 })
      .select("name _id");
    
    const formatted = salespersons.map((sp) => ({
      id: sp._id.toString(),
      name: sp.name,
    }));

    res.json(formatted);
  } catch (error) {
    console.error("Error fetching salespersons:", error);
    res.status(500).json({ msg: "Failed to fetch salespersons" });
  }
};

// ─── Add new salesperson ──────────────────────────────────────────────
exports.addSalesperson = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ msg: "Salesperson name is required" });
    }

    const trimmedName = name.trim();

    const existing = await Salesperson.findOne({
      name: { $regex: new RegExp(`^${trimmedName}$`, "i") },
    });

    if (existing) {
      return res.status(400).json({ 
        msg: `"${trimmedName}" already exists` 
      });
    }

    const salesperson = new Salesperson({
      name: trimmedName,
      createdBy: req.user?.name || "system",
    });

    await salesperson.save();

    res.status(201).json({
      id: salesperson._id.toString(),
      name: salesperson.name,
    });
  } catch (error) {
    console.error("Error adding salesperson:", error);
    res.status(500).json({ msg: "Failed to add salesperson" });
  }
};

// ─── Delete salesperson (soft delete) ─────────────────────────────────
exports.deleteSalesperson = async (req, res) => {
  try {
    const { id } = req.params;

    const salesperson = await Salesperson.findById(id);
    if (!salesperson) {
      return res.status(404).json({ msg: "Salesperson not found" });
    }

    salesperson.isActive = false;
    await salesperson.save();

    res.json({ msg: "Salesperson deleted successfully" });
  } catch (error) {
    console.error("Error deleting salesperson:", error);
    res.status(500).json({ msg: "Failed to delete salesperson" });
  }
};

// ─── Update salesperson ──────────────────────────────────────────────
exports.updateSalesperson = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ msg: "Salesperson name is required" });
    }

    const trimmedName = name.trim();

    const existing = await Salesperson.findOne({
      name: { $regex: new RegExp(`^${trimmedName}$`, "i") },
      _id: { $ne: id },
    });

    if (existing) {
      return res.status(400).json({ 
        msg: `"${trimmedName}" already exists` 
      });
    }

    const salesperson = await Salesperson.findByIdAndUpdate(
      id,
      { name: trimmedName },
      { new: true }
    );

    if (!salesperson) {
      return res.status(404).json({ msg: "Salesperson not found" });
    }

    res.json({
      id: salesperson._id.toString(),
      name: salesperson.name,
    });
  } catch (error) {
    console.error("Error updating salesperson:", error);
    res.status(500).json({ msg: "Failed to update salesperson" });
  }
};