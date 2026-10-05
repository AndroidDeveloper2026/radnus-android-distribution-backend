
// utils/roleHierarchy.js
//
//  Admin
//   ├── Radnus (inventory)                  – no travel, no tracking
//   └── MarketingManager                    – tracked
//         └── MarketingExecutive            – tracked
//               ├── Distributor             – tracked
//               └── MarketingExecutive      – tracked
//                     └── FSE               – tracked  (parent: Distributor OR Marketing Executive)
//
// The same ROLE can appear at two levels (Marketing Executive), so *who sees
// whom* is decided by the real person-to-person link `Register.parentId`,
// never by the role name alone.

// role -> roles that are allowed to be its direct superior / approver
const ROLE_APPROVER_MAP = {
  Radnus: ['Admin'],
  MarketingManager: ['Admin'],
  MarketingExecutive: ['MarketingManager', 'MarketingExecutive'],
  Distributor: ['MarketingExecutive'],
  FSE: ['Distributor', 'MarketingExecutive'],
  Retailer: ['FSE'],
};

// Roles that travel and therefore start/end a day and are GPS-tracked.
// Admin and Radnus never travel.
const TRACKED_ROLES = ['MarketingManager', 'MarketingExecutive', 'Distributor', 'FSE'];

// Roles that must pick a specific superior (stored in parentId) at registration.
// MarketingManager's superior is Admin (Admin has no Register document, so no parentId).
// Retailer keeps the old behaviour (any FSE can approve).
const ROLES_REQUIRING_PARENT_SELECTION = ['MarketingExecutive', 'Distributor', 'FSE'];

const ROLE_LABELS = {
  Admin: 'Admin',
  Radnus: 'Radnus Employee',
  MarketingManager: 'Marketing Manager',
  MarketingExecutive: 'Marketing Executive',
  Distributor: 'Distributor',
  FSE: 'FSE',
  Retailer: 'Retailer',
};

function getApproverRoles(role) {
  return ROLE_APPROVER_MAP[role] || [];
}

// Backwards compatible: older callers expect a single role string.
function getApproverRole(role) {
  return getApproverRoles(role)[0] || null;
}

function requiresApproval(role) {
  return role !== 'Admin' && getApproverRoles(role).length > 0;
}

function requiresParentSelection(role) {
  return ROLES_REQUIRING_PARENT_SELECTION.includes(role);
}

// roles whose registrations `approverRole` is allowed to approve
function getChildRoles(approverRole) {
  return Object.keys(ROLE_APPROVER_MAP).filter((role) =>
    ROLE_APPROVER_MAP[role].includes(approverRole),
  );
}

function isTrackedRole(role) {
  return TRACKED_ROLES.includes(role);
}

module.exports = {
  ROLE_APPROVER_MAP,
  TRACKED_ROLES,
  ROLES_REQUIRING_PARENT_SELECTION,
  ROLE_LABELS,
  getApproverRole,
  getApproverRoles,
  requiresApproval,
  requiresParentSelection,
  getChildRoles,
  isTrackedRole,
};

//------------ 05.10.26 Backup -------------
// // utils/roleHierarchy.js
// //
// // Single source of truth for the hierarchical approval system.
// // Extend this map to add new roles / approval levels in future without
// // touching controller logic.
// //
// // ROLE_APPROVER_MAP[role] = the role that must approve a new registration
// // of `role`. Admin requires no approval (omitted from the map).
// //
// // ROLES_REQUIRING_PARENT_SELECTION = roles for which the registering user
// // must pick a *specific* parent (since there can be many approvers with
// // that role, e.g. many Distributors). Roles approved directly by Admin
// // (Radnus, MarketingManager) don't require picking a specific Admin -
// // any Admin can review/approve them.

// const ROLE_APPROVER_MAP = {
//   Radnus: 'Admin',
//   MarketingManager: 'Admin',
//   Distributor: 'MarketingManager',
//   MarketingExecutive: 'MarketingManager',
//   FSE: 'Distributor',
//   Retailer: 'FSE',
// };

// // No role requires picking a *specific* parent during registration.
// // Any approver holding the correct approver role can see and act on
// // pending requests for their child role(s) — visibility is role-based,
// // not assigned-individual-based. Kept as an (empty) list + helper so
// // per-role parent assignment can be reintroduced later without
// // touching controller logic elsewhere.
// const ROLES_REQUIRING_PARENT_SELECTION = [];

// // Human readable labels (used in messages/notifications)
// const ROLE_LABELS = {
//   Admin: 'Admin',
//   Radnus: 'Radnus Employee',
//   MarketingManager: 'Marketing Manager',
//   MarketingExecutive: 'Marketing Executive',
//   Distributor: 'Distributor',
//   FSE: 'FSE',
//   Retailer: 'Retailer',
// };

// function getApproverRole(role) {
//   return ROLE_APPROVER_MAP[role] || null;
// }

// function requiresApproval(role) {
//   return role !== 'Admin' && !!getApproverRole(role);
// }

// function requiresParentSelection(role) {
//   return ROLES_REQUIRING_PARENT_SELECTION.includes(role);
// }

// // Roles that the given approver role is allowed to approve (children roles)
// function getChildRoles(approverRole) {
//   return Object.keys(ROLE_APPROVER_MAP).filter(
//     (role) => ROLE_APPROVER_MAP[role] === approverRole,
//   );
// }

// module.exports = {
//   ROLE_APPROVER_MAP,
//   ROLES_REQUIRING_PARENT_SELECTION,
//   ROLE_LABELS,
//   getApproverRole,
//   requiresApproval,
//   requiresParentSelection,
//   getChildRoles,
// };
