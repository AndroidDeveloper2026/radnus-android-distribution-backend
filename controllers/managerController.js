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

    const manager = new Manager({
      ...req.body,
      photo: photoUrl,
    });

    await manager.save();

    res.status(201).json(manager);

  } catch (error) {
    console.error("CREATE MANAGER ERROR:", error);
    res.status(500).json({ message: error.message });
  }
};


/* GET ALL MANAGERS */

exports.getManagers = async (req, res) => {
  try {
    const managers = await Manager.find().sort({ createdAt: -1 });

    res.json(managers);

  } catch (error) {
    res.status(500).json({ message: error.message });
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

  } catch (error) {
    console.error("UPDATE MANAGER ERROR:", error);
    res.status(500).json({ message: error.message });
  }
};


/* DELETE MANAGER */

exports.deleteManager = async (req, res) => {
  try {
    await Manager.findByIdAndDelete(req.params.id);

    res.json({ message: "Manager deleted" });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};