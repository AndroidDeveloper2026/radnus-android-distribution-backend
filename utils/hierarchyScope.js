
// utils/hierarchyScope.js
// Who can see whose tracking data.
//   * You see yourself + everyone below you (children, grandchildren, ...).
//   * Admin sees every tracked user.
//   * Nobody sees upward or sideways.
const mongoose = require('mongoose');
const Register = require('../models/Register');
const { TRACKED_ROLES } = require('./roleHierarchy');

const MAX_DEPTH = 10; // safety guard against bad/cyclic data

const isValidId = (id) => !!id && mongoose.Types.ObjectId.isValid(String(id));

// Ids of everyone below `user` (tracked roles only). Admin => all tracked users.
async function getSubordinateIds(user) {
  if (!user) return [];

  if (user.role === 'Admin') {
    const all = await Register.find({
      role: { $in: TRACKED_ROLES },
      // legacy accounts have NO stored approvalStatus — $nin also matches
      // those, whereas "approvalStatus: 'approved'" silently skips them.
      approvalStatus: { $nin: ['pending', 'rejected'] },
    })
      .select('_id')
      .lean();
    return all.map((u) => String(u._id));
  }

  if (!isValidId(user.id)) return [];

  const seen = new Set([String(user.id)]);
  const out = [];
  let frontier = [String(user.id)];

  for (let depth = 0; frontier.length && depth < MAX_DEPTH; depth++) {
    const kids = await Register.find({
      parentId: { $in: frontier },
      role: { $in: TRACKED_ROLES },
    })
      .select('_id')
      .lean();

    frontier = [];
    for (const k of kids) {
      const id = String(k._id);
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
        frontier.push(id);
      }
    }
  }
  return out;
}

// Direct reports only (one level).
async function getDirectReportIds(user) {
  if (!user || !isValidId(user.id)) return [];
  const kids = await Register.find({
    parentId: user.id,
    role: { $in: TRACKED_ROLES },
  })
    .select('_id')
    .lean();
  return kids.map((k) => String(k._id));
}

// Chain of superiors above `userId` (nearest first). Admin is not included
// (it has no Register document) – callers broadcast to the 'admin' room.
async function getAncestorIds(userId) {
  const out = [];
  if (!isValidId(userId)) return out;

  let cur = await Register.findById(userId).select('parentId').lean();
  for (let i = 0; cur && cur.parentId && i < MAX_DEPTH; i++) {
    const pid = String(cur.parentId);
    if (out.includes(pid)) break; // cycle guard
    out.push(pid);
    cur = await Register.findById(pid).select('parentId').lean();
  }
  return out;
}

async function canViewUser(viewer, targetUserId) {
  if (!viewer || !targetUserId) return false;
  if (viewer.role === 'Admin') return true;
  if (!isValidId(viewer.id)) return false;
  if (String(viewer.id) === String(targetUserId)) return true;
  const ancestors = await getAncestorIds(targetUserId);
  return ancestors.includes(String(viewer.id));
}

// Would making `newParentId` the parent of `userId` create a loop?
async function wouldCreateCycle(userId, newParentId) {
  if (String(userId) === String(newParentId)) return true;
  const ancestors = await getAncestorIds(newParentId);
  return ancestors.includes(String(userId));
}

module.exports = {
  getSubordinateIds,
  getDirectReportIds,
  getAncestorIds,
  canViewUser,
  wouldCreateCycle,
};

//--------------------------- 08.10.2026 ------------------------------
// // utils/hierarchyScope.js
// // Who can see whose tracking data.
// //   * You see yourself + everyone below you (children, grandchildren, ...).
// //   * Admin sees every tracked user.
// //   * Nobody sees upward or sideways.
// const mongoose = require('mongoose');
// const Register = require('../models/Register');
// const { TRACKED_ROLES } = require('./roleHierarchy');

// const MAX_DEPTH = 10; // safety guard against bad/cyclic data

// const isValidId = (id) => !!id && mongoose.Types.ObjectId.isValid(String(id));

// // Ids of everyone below `user` (tracked roles only). Admin => all tracked users.
// async function getSubordinateIds(user) {
//   if (!user) return [];

//   if (user.role === 'Admin') {
//     const all = await Register.find({
//       role: { $in: TRACKED_ROLES },
//       approvalStatus: 'approved',
//     })
//       .select('_id')
//       .lean();
//     return all.map((u) => String(u._id));
//   }

//   if (!isValidId(user.id)) return [];

//   const seen = new Set([String(user.id)]);
//   const out = [];
//   let frontier = [String(user.id)];

//   for (let depth = 0; frontier.length && depth < MAX_DEPTH; depth++) {
//     const kids = await Register.find({
//       parentId: { $in: frontier },
//       role: { $in: TRACKED_ROLES },
//     })
//       .select('_id')
//       .lean();

//     frontier = [];
//     for (const k of kids) {
//       const id = String(k._id);
//       if (!seen.has(id)) {
//         seen.add(id);
//         out.push(id);
//         frontier.push(id);
//       }
//     }
//   }
//   return out;
// }

// // Direct reports only (one level).
// async function getDirectReportIds(user) {
//   if (!user || !isValidId(user.id)) return [];
//   const kids = await Register.find({
//     parentId: user.id,
//     role: { $in: TRACKED_ROLES },
//   })
//     .select('_id')
//     .lean();
//   return kids.map((k) => String(k._id));
// }

// // Chain of superiors above `userId` (nearest first). Admin is not included
// // (it has no Register document) – callers broadcast to the 'admin' room.
// async function getAncestorIds(userId) {
//   const out = [];
//   if (!isValidId(userId)) return out;

//   let cur = await Register.findById(userId).select('parentId').lean();
//   for (let i = 0; cur && cur.parentId && i < MAX_DEPTH; i++) {
//     const pid = String(cur.parentId);
//     if (out.includes(pid)) break; // cycle guard
//     out.push(pid);
//     cur = await Register.findById(pid).select('parentId').lean();
//   }
//   return out;
// }

// async function canViewUser(viewer, targetUserId) {
//   if (!viewer || !targetUserId) return false;
//   if (viewer.role === 'Admin') return true;
//   if (!isValidId(viewer.id)) return false;
//   if (String(viewer.id) === String(targetUserId)) return true;
//   const ancestors = await getAncestorIds(targetUserId);
//   return ancestors.includes(String(viewer.id));
// }

// // Would making `newParentId` the parent of `userId` create a loop?
// async function wouldCreateCycle(userId, newParentId) {
//   if (String(userId) === String(newParentId)) return true;
//   const ancestors = await getAncestorIds(newParentId);
//   return ancestors.includes(String(userId));
// }

// module.exports = {
//   getSubordinateIds,
//   getDirectReportIds,
//   getAncestorIds,
//   canViewUser,
//   wouldCreateCycle,
// };
