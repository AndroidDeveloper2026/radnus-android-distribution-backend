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

exports.createProduct = async (req, res) => {
  try {
    let imageUrl = null;

    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer, "products");
      imageUrl = result.secure_url;
    }

    const product = await Product.create({
      ...req.body,
      image: imageUrl,
    });

    res.status(201).json(product);
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
};

/* GET ALL PRODUCTS */
exports.getProducts = async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    let imageUrl;

    // If new image uploaded
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer, "products");
      imageUrl = result.secure_url;
    }

    const updateData = {
      ...req.body,
      ...(imageUrl && { image: imageUrl }),
    };

    const updated = await Product.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    res.json(updated);
  } catch (err) {
    console.error("UPDATE PRODUCT ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

/* DELETE PRODUCT */
exports.deleteProduct = async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: "Product deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* REDUCE STOCK - FIXED WITH VALIDATION */
exports.reduceStock = async (req, res) => {
  const { items } = req.body;

  try {
    // ✅ First, verify all items have sufficient stock
    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product) {
        return res.status(404).json({ 
          error: `Product ${item.productId} not found` 
        });
      }
      
      if (product.stock < item.qty) {
        return res.status(400).json({ 
          error: `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.qty}` 
        });
      }
    }

    // ✅ If all checks pass, reduce stock
    const bulkOps = items.map((item) => ({
      updateOne: {
        filter: { _id: item.productId },
        update: { $inc: { stock: -item.qty } },
      },
    }));

    await Product.bulkWrite(bulkOps);
    
    res.json({ 
      success: true,
      message: 'Stock updated successfully' 
    });
  } catch (err) {
    console.error("Reduce stock error:", err);
    res.status(500).json({ error: err.message });
  }
};

/* GET STOCK STATUS */
exports.getStockStatus = async (req, res) => {
  try {
    const products = await Product.find({}, 'name sku stock moq');
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* BULK UPLOAD (EXCEL / CSV) */
exports.bulkUploadProducts = async (req, res) => {
  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);
    
    // ✅ Validate data before inserting
    const validatedData = data.map(item => ({
      ...item,
      stock: Number(item.stock) || 0,
      moq: Number(item.moq) || 1,
      retailerPrice: Number(item.retailerPrice) || 0,
      distributorPrice: Number(item.distributorPrice) || 0,
      mrp: Number(item.mrp) || 0,
    }));

    await Product.insertMany(validatedData);
    res.json({ message: "Bulk upload successful", count: validatedData.length });
  } catch (err) {
    console.error("Bulk upload error:", err);
    res.status(500).json({ error: err.message });
  }
};