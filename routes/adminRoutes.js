// routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const adminApprovalController = require('../controllers/adminApprovalController');

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// All routes require authentication and admin role
router.use(auth, isAdmin);

// Approval management
router.get('/pending-approvals', adminApprovalController.getPendingApprovals);
router.post('/approve-user/:userId', adminApprovalController.approveUser);
router.post('/reject-user/:userId', adminApprovalController.rejectUser);
router.get('/approved-users', adminApprovalController.getApprovedUsers);

module.exports = router;