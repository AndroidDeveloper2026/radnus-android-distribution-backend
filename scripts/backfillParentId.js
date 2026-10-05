// scripts/backfillParentId.js
// One-time migration: give existing users a superior (parentId).
//   Rule: parentId = approvedBy, if that approver's role is valid for the user's role.
//   Anyone left over must be assigned by Admin (PATCH /api/admin/hierarchy/users/:id/parent).
//
//   NODE_ENV=production node scripts/backfillParentId.js --dry-run
//   NODE_ENV=production node scripts/backfillParentId.js
require('dotenv').config({ path: `.env.${process.env.NODE_ENV || 'dev'}` });
const mongoose = require('mongoose');
const Register = require('../models/Register');
const { ROLES_REQUIRING_PARENT_SELECTION, getApproverRoles } = require('../utils/roleHierarchy');

const DRY = process.argv.includes('--dry-run');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const users = await Register.find({
    role: { $in: ROLES_REQUIRING_PARENT_SELECTION },
    parentId: null,
  });

  let fixed = 0;
  const unresolved = [];

  for (const u of users) {
    let parent = null;
    if (u.approvedBy) parent = await Register.findById(u.approvedBy).select('role name');
    if (parent && getApproverRoles(u.role).includes(parent.role)) {
      console.log(`${DRY ? '[dry] ' : ''}${u.role} ${u.name} -> ${parent.role} ${parent.name}`);
      if (!DRY) {
        u.parentId = parent._id;
        await u.save({ validateBeforeSave: false });
      }
      fixed++;
    } else {
      unresolved.push(`${u.role} ${u.name} (${u._id})`);
    }
  }

  console.log(`\nAssigned: ${fixed}   Needs manual assignment: ${unresolved.length}`);
  unresolved.forEach((x) => console.log('  - ' + x));
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
