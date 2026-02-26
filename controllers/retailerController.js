const Retailer = require("../models/RetailerModel/Retailer");

exports.createRetailer = async (req, res) => {
  try {
    const data = req.body;
    const file = req.file;

    let shopPhoto = null;

    if (file) {
      // ✅ Convert image to base64
      shopPhoto = file.buffer.toString("base64");
    }

    const retailer = new Retailer({
      ...data,
      shopPhoto, // ✅ store base64
    });

    await retailer.save();

    res.status(201).json(retailer);
  } catch (err) {
    console.log("ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.getRetailers = async (req, res) => {
  const data = await Retailer.find().sort({ createdAt: -1 });
  res.json(data);
};

exports.updateStatus = async (req, res) => {
  const updated = await Retailer.findByIdAndUpdate(
    req.params.id,
    { status: req.body.status },
    { new: true },
  );
  res.json(updated);
};
