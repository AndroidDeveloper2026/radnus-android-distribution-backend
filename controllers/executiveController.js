const Executive = require("../models/Executive/Executive");
const cloudinary = require("cloudinary").v2;

/* CREATE EXECUTIVE */

const uploadToCloudinary = require("../utils/cloudinaryUpload");

exports.createExecutive = async (req, res) => {
  try {
    let photoUrl = null;

    if (req.file) {
      const result = await uploadToCloudinary(
        req.file.buffer,
        "executives"
      );

      photoUrl = result.secure_url;
    }

    const executive = new Executive({
      ...req.body,
      photo: photoUrl,
    });

    await executive.save();

    res.status(201).json(executive);

  } catch (error) {
    console.error("CREATE EXECUTIVE ERROR:", error);
    res.status(500).json({ message: error.message });
  }
};


/* GET ALL EXECUTIVES */

exports.getExecutives = async (req, res) => {
  try {
    const executives = await Executive.find().sort({ createdAt: -1 });

    res.json(executives);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


/* UPDATE EXECUTIVE */

exports.updateExecutive = async (req, res) => {
  try {
    let updateData = { ...req.body };

    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: "executives",
      });

      updateData.photo = result.secure_url;
    }

    const executive = await Executive.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    res.json(executive);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


/* DELETE EXECUTIVE */

exports.deleteExecutive = async (req, res) => {
  try {
    await Executive.findByIdAndDelete(req.params.id);

    res.json({ message: "Executive deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};