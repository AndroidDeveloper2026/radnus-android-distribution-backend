const Retailer = require("../models/RetailerModel/Retailer");

exports.createRetailer = async (req, res) => {
  try {
    const file = req.file;

    const retailer = new Retailer({
      ...req.body,
      shopPhoto: file?.filename,
    });

    await retailer.save();

    res.status(201).json(retailer);
  } catch (err) {
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
    { new: true }
  );
  res.json(updated);
};