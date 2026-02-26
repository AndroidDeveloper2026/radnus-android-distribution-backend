const Retailer = require("../models/RetailerModel/Retailer");

exports.createRetailer = async (req, res) => {
  try {
    console.log("BODY:", req.body);
    console.log("FILE:", req.file);

    if (!req.file) {
      return res.status(400).json({ message: "Image upload failed" });
    }

    const retailer = new Retailer({
      shopName: req.body.shopName,
      ownerName: req.body.ownerName,
      mobile: req.body.mobile,
      gps: req.body.gps,
      shopPhoto: req.file.filename,
    });

    await retailer.save();

    res.status(201).json(retailer);
  } catch (err) {
    console.log("SERVER ERROR:", err);
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
