const Distributor = require("../models/Distributor/DistributorModal");

const uploadToCloudinary = require("../utils/cloudinaryUpload");

exports.createDistributor = async (req, res) => {
  try {
    const data = req.body;

    let profileUrl = null;

    // 📸 Upload to Cloudinary
    if (req.file) {
      const result = await uploadToCloudinary(
        req.file.buffer,
        "distributors"
      );
      profileUrl = result.secure_url;
    }

    const distributor = new Distributor({
      ...data,
      images: {
        profile: profileUrl, // ✅ store URL
      },
    });

    await distributor.save();

    res.status(201).json(distributor);

  } catch (error) {
    console.error("CREATE DISTRIBUTOR ERROR:", error);
    res.status(500).json({ message: error.message });
  }
};

/* GET ALL */
exports.getDistributors = async (req, res) => {
  try {
    const { status } = req.query;

    let filter = {};
    if (status) {
      filter.status = status;
    }

    const distributors = await Distributor.find(filter).sort({
      createdAt: -1,
    });

    res.json(distributors);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* UPDATE */
exports.updateDistributor = async (req, res) => {
  try {
    const updated = await Distributor.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* DELETE */
exports.deleteDistributor = async (req, res) => {
  try {
    await Distributor.findByIdAndDelete(req.params.id);

    res.json({ message: "Distributor deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* STATUS UPDATE */
exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const updated = await Distributor.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};