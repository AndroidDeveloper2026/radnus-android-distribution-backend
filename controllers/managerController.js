const Manager = require("../models/Manager/managerModel");
const uploadToCloudinary = require("../utils/cloudinaryUpload");

/* CREATE MANAGER */

exports.createManager = async (req, res) => {
  try {
    let photoUrl = null;

    if (req.file) {
      const result = await uploadToCloudinary(
        req.file.buffer,
        "managers"
      );

      photoUrl = result.secure_url;
    }

    const manager = await Manager.create({
      ...req.body,
      photo: photoUrl,
    });

    res.status(201).json(manager);
  } catch (err) {
    console.error("CREATE MANAGER ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};


/* GET MANAGERS */

exports.getManagers = async (req, res) => {
  try {
    const list = await Manager.find().sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


/* UPDATE MANAGER */

exports.updateManager = async (req, res) => {
  try {
    let updateData = { ...req.body };

    if (req.file) {
      const result = await uploadToCloudinary(
        req.file.buffer,
        "managers"
      );

      updateData.photo = result.secure_url;
    }

    const manager = await Manager.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    res.json(manager);
  } catch (err) {
    console.error("UPDATE MANAGER ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};


/* DELETE MANAGER */

exports.deleteManager = async (req, res) => {
  try {
    await Manager.findByIdAndDelete(req.params.id);

    res.json({ message: "Manager deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};