const User = require("../models/Register"); 
const uploadToCloudinary = require("../utils/cloudinaryUpload");

// GET /api/profile/me
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/profile/me
exports.updateProfile = async (req, res) => {
  try {
    const { role, ...fields } = req.body;
    const userId = req.user.id;
    let photoUrl = null;

    // 1. Upload photo if file is present
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer, "profile_photos");
      photoUrl = result.secure_url;
    }

    // 2. Determine allowed fields per role
    const allowedFields = getRoleFields(role);
    const updateData = {};
    Object.keys(fields).forEach((key) => {
      if (allowedFields.includes(key)) {
        updateData[key] = fields[key];
      }
    });

    // 3. Assign the correct image field
    if (photoUrl) {
      const imageField = role === "Retailer" ? "shopPhoto" : "photo";
      updateData[imageField] = photoUrl;
    }

    // 4. Update user
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, select: "-password" }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(updatedUser);
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Helper: allowed fields per role
function getRoleFields(role) {
  switch (role) {
    case "Distributor":
      return [
        "businessName", "alternateMobile", "gst", "msme",
        "address", "communicationAddress"
      ];
    case "Retailer":
      return ["shopName", "ownerName"];
    case "Executive":
    case "MarketingExecutive":
      return ["name", "dob", "alternatePhone", "address", "photo"];

    case "Radnus":
      return ["name", "dob", "altPhone", "address", "altAddress", "photo"];
    default:
      return ["name"];
  }
}