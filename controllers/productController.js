const Product = require("../models/AdminModel/Product");
const XLSX = require("xlsx");

/* CREATE PRODUCT */
exports.createProduct = async (req, res) => {
  try {
    const image = req.file ? req.file.path : null;

    const product = await Product.create({
      ...req.body,
      image,
    });

    res.status(201).json(product);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

/* GET ALL PRODUCTS */
exports.getProducts = async (req, res) => {
  const products = await Product.find().sort({ createdAt: -1 });
  res.json(products);
};

/* UPDATE PRODUCT */
exports.updateProduct = async (req, res) => {
  const image = req.file ? req.file.path : undefined;

  const updated = await Product.findByIdAndUpdate(
    req.params.id,
    { ...req.body, ...(image && { image }) },
    { new: true }
  );

  res.json(updated);
};

/* DELETE PRODUCT */
exports.deleteProduct = async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  res.json({ message: "Product deleted" });
};

/* BULK UPLOAD (EXCEL / CSV) */
exports.bulkUploadProducts = async (req, res) => {
  const workbook = XLSX.readFile(req.file.path);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  const data = XLSX.utils.sheet_to_json(sheet);

  /*
   Excel columns expected:
   name | sku | category | mrp | distributorPrice | retailerPrice | gst | moq
  */

  await Product.insertMany(data);
  res.json({ message: "Bulk upload successful", count: data.length });
};
