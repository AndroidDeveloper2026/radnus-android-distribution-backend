const Retailer = require("../models/RetailerModel/Retailer");
const cloudinary = require("../config/cloudinary");
const streamifier = require("streamifier");

exports.createRetailer = async (req, res) => {
  try {
    let imageUrl = "";

    if (req.file) {
      const streamUpload = () => {
        return new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "retailers" },
            (error, result) => {
              if (result) resolve(result);
              else reject(error);
            },
          );

          streamifier.createReadStream(req.file.buffer).pipe(stream);
        });
      };

      const result = await streamUpload();
      imageUrl = result.secure_url;
    }

    const retailer = await Retailer.create({
      shopName: req.body.shopName,
      ownerName: req.body.ownerName,
      mobile: req.body.mobile,
      gps: req.body.gps,
      area: req.body.area, 
      address: req.body.address, 
      gst: req.body.gst, 
      shopPhoto: imageUrl, 
    });

    res.json(retailer);
  } catch (err) {
    console.log("ERROR:", err);
    res.status(500).json({ message: err.message });
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
