const Retailer = require("../models/RetailerModel/Retailer");

// exports.createRetailer = async (req, res) => {
//   try {
//     const data = req.body;
//     const file = req.file;

//     let shopPhoto = null;

//     if (file) {
//       shopPhoto = file.buffer.toString("base64");
//     }

//     const retailer = new Retailer({
//       ...req.body,
//       shopPhoto,
//     });

//     await retailer.save();

//     res.status(201).json(retailer);
//   } catch (err) {
//     console.log("ERROR:", err);
//     res.status(500).json({ message: err.message });
//   }
// };

exports.createRetailer = async (req, res) => {
  try {
    console.log("BODY:", req.body);
    console.log("FILE:", req.file);

    let shopPhoto = null;

    if (req.file) {
      // ✅ Convert buffer → base64
      shopPhoto = req.file.buffer.toString("base64");
    }

    const retailer = new Retailer({
      shopName: req.body.shopName,
      ownerName: req.body.ownerName,
      mobile: req.body.mobile,
      gps: req.body.gps,
      shopPhoto,
    });

    await retailer.save();

    res.status(201).json({
      success: true,
      data: retailer,
    });
  } catch (err) {
    console.log("❌ ERROR:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.getRetailers = async (req, res) => {
  const data = await Retailer.find().sort({ createdAt: -1 });
  res.json(data);
};

exports.updateRetailer = async (req, res) => {
  try {
    const updated = await Retailer.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteRetailer = async (req, res) => {
  try {
    await Retailer.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateStatus = async (req, res) => {
  const updated = await Retailer.findByIdAndUpdate(
    req.params.id,
    { status: req.body.status },
    { new: true },
  );
  res.json(updated);
};
