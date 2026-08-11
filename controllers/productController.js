// controllers/productController.js - COMPLETE FIXED VERSION

const Product = require("../models/AdminModel/Product");
const StockBatch = require("../models/Purchase/StockBatch");
const XLSX = require("xlsx");
const uploadToCloudinary = require("../utils/cloudinaryUpload");

// ─── CREATE PRODUCT ──────────────────────────────────────────────────────────

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

    res.status(201).json({
      success: true,
      product
    });
  } catch (err) {
    console.error("❌ Create product error:", err);
    res.status(400).json({ 
      success: false,
      message: err.message 
    });
  }
};

// ─── GET ALL PRODUCTS ────────────────────────────────────────────────────────

exports.getProducts = async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    console.error("❌ Get products error:", err);
    res.status(500).json({ 
      success: false,
      message: err.message 
    });
  }
};

// ─── UPDATE PRODUCT ─────────────────────────────────────────────────────────

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

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      product: updated
    });

  } catch (err) {
    console.error("❌ UPDATE PRODUCT ERROR:", err);
    res.status(500).json({ 
      success: false,
      message: err.message 
    });
  } 
};

// ─── DELETE PRODUCT ─────────────────────────────────────────────────────────

exports.deleteProduct = async (req, res) => {
  try {
    const deleted = await Product.findByIdAndDelete(req.params.id);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    res.json({ 
      success: true,
      message: "Product deleted" 
    });
  } catch (err) {
    console.error("❌ Delete product error:", err);
    res.status(500).json({ 
      success: false,
      message: err.message 
    });
  }
};

// ─── REDUCE STOCK (BULK) ────────────────────────────────────────────────────

exports.reduceStock = async (req, res) => {
  const { items } = req.body;

  try {
    const bulkOps = items.map((item) => ({
      updateOne: {
        filter: { _id: item.productId },
        update: { $inc: { moq: -item.qty } },
      },
    }));

    const result = await Product.bulkWrite(bulkOps);
    
    res.json({ 
      success: true,
      message: 'Stock updated successfully',
      result
    });
  } catch (err) {
    console.error("❌ Reduce stock error:", err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
};

// ─── UPDATE PRODUCT STOCK (INDIVIDUAL) ─────────────────────────────────────

exports.updateProductStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, operation } = req.body;

    if (!quantity || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be greater than 0'
      });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const currentStock = product.moq || 0;
    let newStock = currentStock;

    if (operation === 'decrease' || operation === 'reduce') {
      if (currentStock < quantity) {
        return res.status(409).json({
          success: false,
          code: 'INSUFFICIENT_STOCK',
          message: `Insufficient stock. Available: ${currentStock}, Requested: ${quantity}`
        });
      }
      newStock = currentStock - quantity;
      console.log(`📉 Stock DECREASED for ${product.name}: ${currentStock} → ${newStock}`);
    } else if (operation === 'increase') {
      newStock = currentStock + quantity;
      console.log(`📈 Stock INCREASED for ${product.name}: ${currentStock} → ${newStock}`);
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid operation. Use "increase" or "decrease"'
      });
    }

    product.moq = newStock;
    await product.save();

    res.json({
      success: true,
      message: `Stock ${operation}d successfully`,
      product: {
        id: product._id,
        name: product.name,
        moq: product.moq,
        sku: product.sku,
      }
    });

  } catch (err) {
    console.error('❌ Update product stock error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to update stock'
    });
  }
};

// ─── UPDATE BATCH STOCK ─────────────────────────────────────────────────────

exports.updateBatchStock = async (req, res) => {
  try {
    const { batchNumber } = req.params;
    const { quantity, operation } = req.body;

    if (!quantity || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be greater than 0'
      });
    }

    const batch = await StockBatch.findOne({ batchNo: batchNumber });
    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found'
      });
    }

    const currentStock = batch.quantityAvailable || 0;
    let newStock = currentStock;

    if (operation === 'decrease' || operation === 'reduce') {
      if (currentStock < quantity) {
        return res.status(409).json({
          success: false,
          code: 'INSUFFICIENT_STOCK',
          message: `Insufficient stock in batch. Available: ${currentStock}, Requested: ${quantity}`
        });
      }
      newStock = currentStock - quantity;
      console.log(`📉 Batch stock DECREASED for ${batchNumber}: ${currentStock} → ${newStock}`);
    } else if (operation === 'increase') {
      newStock = currentStock + quantity;
      console.log(`📈 Batch stock INCREASED for ${batchNumber}: ${currentStock} → ${newStock}`);
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid operation. Use "increase" or "decrease"'
      });
    }

    batch.quantityAvailable = newStock;
    await batch.save();

    res.json({
      success: true,
      message: `Batch stock ${operation}d successfully`,
      batch: {
        batchNo: batch.batchNo,
        quantityAvailable: batch.quantityAvailable,
        productId: batch.productId,
      }
    });

  } catch (err) {
    console.error('❌ Update batch stock error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to update batch stock'
    });
  }
};

// ─── BULK UPLOAD (EXCEL / CSV) ─────────────────────────────────────────────

exports.bulkUploadProducts = async (req, res) => {
  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    const result = await Product.insertMany(data);
    
    res.json({ 
      success: true,
      message: "Bulk upload successful", 
      count: result.length 
    });
  } catch (err) {
    console.error("❌ Bulk upload error:", err);
    res.status(500).json({ 
      success: false,
      message: err.message 
    });
  }
};

//-------- 11.08.2026 -------------------
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

// // exports.reduceStock = async (req, res) => {
// //   const { items } = req.body;

// //   try {
// //     const bulkOps = items.map((item) => ({
// //       updateOne: {
// //         filter: { _id: item.productId },
// //         update: { $inc: { stock: -item.qty } }, // ✅ reduce stock, NOT moq
// //       },
// //     }));

// //     await Product.bulkWrite(bulkOps);
// //     res.json({ message: 'Stock updated successfully' });
// //   } catch (err) {
// //     res.status(500).json({ error: err.message });
// //   }
// // };

// exports.reduceStock = async (req, res) => {
//   const { items } = req.body;

//   try {
//     const bulkOps = items.map((item) => ({
//       updateOne: {
//         filter: { _id: item.productId },
//         // ✅ CHANGE: subtract from 'moq' (the stock field in your schema)
//         update: { $inc: { moq: -item.qty } },
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



// // controllers/productController.js - Add this new function

// // ─── NEW: Update product stock after order ─────────────────────────────────────

// exports.updateProductStock = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { quantity } = req.body; // Negative for reduction
    
//     const product = await Product.findById(id);
//     if (!product) {
//       return res.status(404).json({ msg: 'Product not found' });
//     }
    
//     // Update stock (moq)
//     const newStock = Math.max(0, (product.moq || 0) + quantity);
//     product.moq = newStock;
//     await product.save();
    
//     res.json({ 
//       success: true, 
//       id: product._id, 
//       newStock 
//     });
//   } catch (err) {
//     res.status(500).json({ msg: err.message });
//   }
// };