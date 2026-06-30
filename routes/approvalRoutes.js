// routes/approvalRoutes.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const approvalController = require('../controllers/approvalController');

// All routes require a logged-in user; authorization (which users they
// can act on) is enforced inside the controller based on the hierarchy.
router.use(auth);

router.get('/pending', approvalController.getPendingApprovals);
router.get('/processed', approvalController.getProcessedApprovals);
router.get('/my-team', approvalController.getMyTeam);
router.get('/view/:userId', approvalController.viewUserDetails);
router.post('/approve/:userId', approvalController.approveUser);
router.post('/reject/:userId', approvalController.rejectUser);

module.exports = router;
