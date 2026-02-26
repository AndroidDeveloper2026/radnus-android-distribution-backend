const Retailer = require("../models/RetailerModel/Retailer");

exports.createRetailer = async (req, res) => {
  try {
    console.log("BODY:", req.body);
    console.log("FILE:", req.file);

    const retailer = new Retailer({
      ...req.body,
      shopPhoto: req.file?.filename,
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
    { new: true },
  );
  res.json(updated);
};
