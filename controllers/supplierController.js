const Supplier = require("../models/Purchase/Supplier");
const PurchaseEntry = require("../models/Purchase/PurchaseEntry");

exports.createSupplier = async (req, res) => {
  try {
    const { name, mobile, email, gstNo, address, status } = req.body;
    if (!name) return res.status(400).json({ msg: "Supplier name is required" });

    const supplier = await Supplier.create({ name, mobile, email, gstNo, address, status });
    res.status(201).json(supplier);
  } catch (err) {
    console.error("createSupplier error:", err);
    res.status(400).json({ msg: err.message });
  }
};

// Returns every supplier with purchaseCount + outstandingBalance attached,
// so the Supplier Master table can render them without N extra requests.
// Client still handles pagination via the shared DataTable component.
exports.getSuppliers = async (req, res) => {
  try {
    const { search = "", status = "" } = req.query;
    const match = {};
    if (status) match.status = status;
    if (search.trim()) {
      const q = search.trim();
      match.$or = [
        { name: { $regex: q, $options: "i" } },
        { mobile: { $regex: q, $options: "i" } },
        { gstNo: { $regex: q, $options: "i" } },
      ];
    }

    const suppliers = await Supplier.aggregate([
      { $match: match },
      {
        $lookup: {
          from: "purchaseentries",
          localField: "_id",
          foreignField: "supplier",
          as: "purchases",
        },
      },
      {
        $addFields: {
          purchaseCount: { $size: "$purchases" },
          outstandingBalance: { $sum: "$purchases.dueAmount" },
        },
      },
      { $project: { purchases: 0 } },
      { $sort: { createdAt: -1 } },
    ]);

    res.json(suppliers);
  } catch (err) {
    console.error("getSuppliers error:", err);
    res.status(500).json({ msg: err.message });
  }
};

exports.getSupplierById = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ msg: "Supplier not found" });

    const purchases = await PurchaseEntry.find({ supplier: supplier._id }).sort({ createdAt: -1 });
    const purchaseCount = purchases.length;
    const outstandingBalance = purchases.reduce((sum, p) => sum + (p.dueAmount || 0), 0);

    res.json({ ...supplier.toObject(), purchaseCount, outstandingBalance, purchases });
  } catch (err) {
    console.error("getSupplierById error:", err);
    res.status(500).json({ msg: err.message });
  }
};

exports.updateSupplier = async (req, res) => {
  try {
    const { name, mobile, email, gstNo, address, status } = req.body;
    const updated = await Supplier.findByIdAndUpdate(
      req.params.id,
      { name, mobile, email, gstNo, address, status },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ msg: "Supplier not found" });
    res.json(updated);
  } catch (err) {
    console.error("updateSupplier error:", err);
    res.status(400).json({ msg: err.message });
  }
};

exports.deleteSupplier = async (req, res) => {
  try {
    const usageCount = await PurchaseEntry.countDocuments({ supplier: req.params.id });
    if (usageCount > 0) {
      return res.status(400).json({
        msg: "Cannot delete a supplier with existing purchase history. Set status to Inactive instead.",
      });
    }
    const deleted = await Supplier.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ msg: "Supplier not found" });
    res.json({ msg: "Supplier deleted successfully" });
  } catch (err) {
    console.error("deleteSupplier error:", err);
    res.status(500).json({ msg: err.message });
  }
};
