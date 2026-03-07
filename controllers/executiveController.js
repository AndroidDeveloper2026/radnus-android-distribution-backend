const Executive = require("../models/Executive/Executive");

/* CREATE EXECUTIVE */

exports.createExecutive = async (req, res) => {
  try {
    const photo = req.file
      ? `http://localhost:5000/uploads/${req.file.filename}`
      : "";

    const executive = new Executive({
      ...req.body,
      photo,
    });

    await executive.save();

    res.json(executive);
  } catch (error) {
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
    const executive = await Executive.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true },
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
