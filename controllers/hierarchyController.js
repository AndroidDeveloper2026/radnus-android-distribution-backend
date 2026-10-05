// controllers/hierarchyController.js
// Maintain the person-to-person superior link (Register.parentId).
const mongoose = require('mongoose');
const Register = require('../models/Register');
const {
  getApproverRoles,
  requiresParentSelection,
  ROLE_LABELS,
} = require('../utils/roleHierarchy');
const { wouldCreateCycle } = require('../utils/hierarchyScope');
const { clearAncestorCache } = require('../utils/teamSocket');

// PUBLIC (registration screen): GET /api/auth/eligible-parents?role=FSE
// Only non-sensitive fields are returned.
exports.getEligibleParents = async (req, res) => {
  try {
    const { role } = req.query;
    if (!role) return res.status(400).json({ message: 'role query param required' });

    if (!requiresParentSelection(role)) return res.json([]);

    const parents = await Register.find({
      role: { $in: getApproverRoles(role) },
      approvalStatus: 'approved',
      isActive: { $ne: false },
    })
      .select('name role district taluk')
      .sort({ role: 1, name: 1 })
      .lean();

    res.json(
      parents.map((p) => ({
        _id: p._id,
        name: p.name,
        role: p.role,
        roleLabel: ROLE_LABELS[p.role] || p.role,
        district: p.district,
        taluk: p.taluk,
      })),
    );
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ADMIN: GET /api/admin/hierarchy/unassigned
// Users who must have a superior but don't (legacy accounts).
exports.listUnassigned = async (req, res) => {
  try {
    const users = await Register.find({
      role: { $in: ['MarketingExecutive', 'Distributor', 'FSE'] },
      parentId: null,
    })
      .select('name role mobile district taluk approvalStatus approvedBy')
      .sort({ role: 1, name: 1 })
      .lean();
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ADMIN: PATCH /api/admin/hierarchy/users/:userId/parent   body: { parentId }
exports.setParent = async (req, res) => {
  try {
    const { userId } = req.params;
    const { parentId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(parentId || '')) {
      return res.status(400).json({ message: 'Valid userId and parentId are required' });
    }

    const [user, parent] = await Promise.all([Register.findById(userId), Register.findById(parentId)]);
    if (!user || !parent) return res.status(404).json({ message: 'User or parent not found' });

    if (!requiresParentSelection(user.role)) {
      return res.status(400).json({ message: `${user.role} does not use a superior link` });
    }
    if (!getApproverRoles(user.role).includes(parent.role)) {
      return res.status(400).json({
        message: `A ${ROLE_LABELS[user.role]} cannot report to a ${ROLE_LABELS[parent.role]}`,
      });
    }
    if (await wouldCreateCycle(user._id, parent._id)) {
      return res.status(400).json({ message: 'This would create a reporting loop' });
    }

    user.parentId = parent._id;
    await user.save();
    clearAncestorCache();

    res.json({
      success: true,
      user: { _id: user._id, name: user.name, role: user.role, parentId: user.parentId },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
