const Manager = require("../models/Manager/managerModel");

exports.createManager = async (req, res) => {
  try {
    const manager = await Manager.create({
      ...req.body,
      photo: req.file?.path,
    });

    res.status(201).json(manager);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getManagers = async (req, res) => {
  try {
    const list = await Manager.find().sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateManager = async (req, res) => {
  try {
    const manager = await Manager.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    res.json(manager);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteManager = async (req, res) => {
  try {
    await Manager.findByIdAndDelete(req.params.id);
    res.json({ message: "Manager deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};