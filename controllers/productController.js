// const Product = require("../models/AdminModel/Product");
// const XLSX = require("xlsx");
// const uploadToCloudinary = require("../utils/cloudinaryUpload");

// exports.createProduct = async (req, res) => {
//   try {
//     let imageUrl = null;

//     if (req.file) {
//       const result = await uploadToCloudinary(req.file.buffer,"products");
//       imageUrl = result.secure_url; 
//     }

//     const product = await Product.create({
//       ...req.body,
//       image: imageUrl,
//     });

//     res.status(201).json(product);
//   } catch (err) {
//     console.error(err);
//     res.status(400).json({ message: err.message });
//   }
// };

// /* GET ALL PRODUCTS */
// exports.getProducts = async (req, res) => {
//   const products = await Product.find().sort({ createdAt: -1 });
//   res.json(products);
// };

// exports.updateProduct = async (req, res) => {
//   try {
//     let imageUrl;

//     // If new image uploaded
//     if (req.file) {
//       const result = await uploadToCloudinary(req.file.buffer, "products");
//       imageUrl = result.secure_url;
//     }

//     const updateData = {
//       ...req.body,
//       ...(imageUrl && { image: imageUrl }),
//     };

//     const updated = await Product.findByIdAndUpdate(
//       req.params.id,
//       updateData,
//       { new: true }
//     );

//     res.json(updated);

//   } catch (err) {
//     console.error("UPDATE PRODUCT ERROR:", err);
//     res.status(500).json({ message: err.message });
//   } 
// };


// /* DELETE PRODUCT */
// exports.deleteProduct = async (req, res) => {
//   await Product.findByIdAndDelete(req.params.id);
//   res.json({ message: "Product deleted" });
// };

// exports.reduceStock = async (req, res) => {
//   const { items } = req.body;

//   try {
//     const bulkOps = items.map((item) => ({
//       updateOne: {
//         filter: { _id: item.productId },
//         update: { $inc: { stock: -item.qty } }, // ✅ reduce stock, NOT moq
//       },
//     }));

//     await Product.bulkWrite(bulkOps);
//     res.json({ message: 'Stock updated successfully' });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };

// /* BULK UPLOAD (EXCEL / CSV) */
// exports.bulkUploadProducts = async (req, res) => {
//   const workbook = XLSX.readFile(req.file.path);
//   const sheet = workbook.Sheets[workbook.SheetNames[0]];

//   const data = XLSX.utils.sheet_to_json(sheet);


//   await Product.insertMany(data);
//   res.json({ message: "Bulk upload successful", count: data.length });
// };

const Product = require("../models/AdminModel/Product");
const XLSX = require("xlsx");
const uploadToCloudinary = require("../utils/cloudinaryUpload");

// ================= CREATE SINGLE PRODUCT =================
exports.createProduct = async (req, res) => {
  try {
    let imageUrl = null;

    // If image file is uploaded, upload to Cloudinary
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer, "products");
      imageUrl = result.secure_url; 
    }

    // Create product with all body data + image URL if available
    const product = await Product.create({
      ...req.body,
      image: imageUrl,
    });

    res.status(201).json(product);
  } catch (err) {
    console.error("❌ CREATE PRODUCT ERROR:", err);
    res.status(400).json({ 
      success: false,
      message: err.message 
    });
  }
};

// ================= GET ALL PRODUCTS (with optional date filter) =================
exports.getProducts = async (req, res) => {
  try {
    const { filter } = req.query; // 'day' | 'week' | 'month' | 'all' | undefined
    let query = {};
    const now = new Date();

    // ─── Date Range Filters (aligned with frontend logic) ───────────────
    
    // Day filter: Today only (midnight to now)
    if (filter === "day") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: start };
    }

    // Week filter: Sunday to Saturday of current week
    if (filter === "week") {
      // Week starts from Sunday (matches frontend isThisWeek logic)
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
      startOfWeek.setHours(0, 0, 0, 0);
      
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6); // Saturday
      endOfWeek.setHours(23, 59, 59, 999);
      
      query.createdAt = { $gte: startOfWeek, $lte: endOfWeek };
    }

    // Month filter: Current calendar month (1st to last day)
    if (filter === "month") {
      // Current calendar month (matches frontend isThisMonth logic)
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      endOfMonth.setHours(23, 59, 59, 999);
      
      query.createdAt = { $gte: startOfMonth, $lte: endOfMonth };
    }

    // If filter is 'all' or not provided, return all products (no date restriction)
    // This keeps backward compatibility with existing code

    const products = await Product.find(query)
      .sort({ createdAt: -1 });
    
    res.json(products);
  } catch (err) {
    console.error("❌ GET PRODUCTS ERROR:", err);
    res.status(500).json({ 
      success: false,
      message: err.message 
    });
  }
};

// ================= UPDATE PRODUCT =================
exports.updateProduct = async (req, res) => {
  try {
    let imageUrl;

    // If new image uploaded, upload to Cloudinary
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer, "products");
      imageUrl = result.secure_url;
    }

    // Prepare update  merge body + new image URL if available
    const updateData = {
      ...req.body,
      ...(imageUrl && { image: imageUrl }),
    };

    // Find and update product, return the updated document
    const updated = await Product.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({
      success: true,
      product: updated,
    });

  } catch (err) {
    console.error("❌ UPDATE PRODUCT ERROR:", err);
    res.status(500).json({ 
      success: false,
      message: err.message 
    });
  } 
};

// ================= DELETE PRODUCT =================
exports.deleteProduct = async (req, res) => {
  try {
    const deleted = await Product.findByIdAndDelete(req.params.id);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.json({ 
      success: true,
      message: "Product deleted successfully",
      product: deleted,
    });
  } catch (err) {
    console.error("❌ DELETE PRODUCT ERROR:", err);
    res.status(500).json({ 
      success: false,
      message: err.message 
    });
  }
};

// ================= REDUCE STOCK (for invoices) =================
exports.reduceStock = async (req, res) => {
  const { items } = req.body;

  try {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Items array is required",
      });
    }

    const bulkOps = items.map((item) => ({
      updateOne: {
        filter: { _id: item.productId },
        update: { $inc: { stock: -item.qty } }, // ✅ reduce stock, NOT moq
      },
    }));

    const result = await Product.bulkWrite(bulkOps);
    
    res.json({ 
      success: true,
      message: "Stock updated successfully",
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    console.error("❌ REDUCE STOCK ERROR:", err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
};

// ================= BULK UPLOAD (EXCEL / CSV) =================
exports.bulkUploadProducts = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    if (!data || data.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid data found in file",
      });
    }

    const result = await Product.insertMany(data, { ordered: false });
    
    res.json({ 
      success: true,
      message: "Bulk upload successful", 
      count: result.length,
      inserted: result.map(p => p._id),
    });
  } catch (err) {
    console.error("❌ BULK UPLOAD ERROR:", err);
    res.status(500).json({ 
      success: false,
      message: err.message,
      errors: err.writeErrors ? err.writeErrors.map(e => e.err) : [],
    });
  }
};