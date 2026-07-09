const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");

const {
  createSupplier,
  getSuppliers,
  getSupplierById,
  updateSupplier,
  deleteSupplier,
} = require("../controllers/supplierController");

router.post("/", auth, createSupplier);
router.get("/", auth, getSuppliers);
router.get("/:id", auth, getSupplierById);
router.put("/:id", auth, updateSupplier);
router.delete("/:id", auth, deleteSupplier);

module.exports = router;
