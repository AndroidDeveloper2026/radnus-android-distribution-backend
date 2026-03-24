const mongoose = require('mongoose');

const InvoiceCounterSchema = new mongoose.Schema({
  financialYear: { type: String, required: true, unique: true }, // e.g. "2026-2027"
  sequence:      { type: Number, default: 0 },
});

module.exports = mongoose.model('InvoiceCounter', InvoiceCounterSchema);