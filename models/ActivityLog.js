// // models/ActivityLog.js
// const mongoose = require('mongoose');

// const activityLogSchema = new mongoose.Schema({
//   action: { type: String, enum: ['ADD_PRODUCT', 'EDIT_PRODUCT','EDIT_CUSTOMER'], required: true },
//   productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
//   productName: { type: String },
//   user: { type: String, required: true },        // login user's name
//   role: { type: String, enum: ['Admin', 'Radnus'], required: true },
//   timestamp: { type: Date, default: Date.now },
// });

// module.exports = mongoose.model('ActivityLog', activityLogSchema);

const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  action: { 
    type: String, 
    enum: ['ADD_PRODUCT', 'EDIT_PRODUCT', 'EDIT_CUSTOMER'], 
    required: true 
  },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  productName: { type: String },
  customerIdentifier: { type: String }, // ✅ phone or name of customer edited
  user: { type: String, required: true },
  role: { type: String, enum: ['Admin', 'Radnus'], required: true },
  changes: { type: Object, default: null },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model('ActivityLog', activityLogSchema);