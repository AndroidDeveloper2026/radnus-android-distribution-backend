const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
  phone: {
    type:     String,
    required: true,
    unique:   true,
    trim:     true,
    length:   10,
  },
  name:    { type: String, required: true, trim: true },
  address: { type: String, default: '' },
  city:    { type: String, default: '' },
  state:   { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Customer', CustomerSchema);