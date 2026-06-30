// utils/roleHierarchy.js
//
// Single source of truth for the hierarchical approval system.
// Extend this map to add new roles / approval levels in future without
// touching controller logic.
//
// ROLE_APPROVER_MAP[role] = the role that must approve a new registration
// of `role`. Admin requires no approval (omitted from the map).
//
// ROLES_REQUIRING_PARENT_SELECTION = roles for which the registering user
// must pick a *specific* parent (since there can be many approvers with
// that role, e.g. many Distributors). Roles approved directly by Admin
// (Radnus, MarketingManager) don't require picking a specific Admin -
// any Admin can review/approve them.

const ROLE_APPROVER_MAP = {
  Radnus: 'Admin',
  MarketingManager: 'Admin',
  Distributor: 'MarketingManager',
  MarketingExecutive: 'MarketingManager',
  FSE: 'Distributor',
  Retailer: 'FSE',
};

// No role requires picking a *specific* parent during registration.
// Any approver holding the correct approver role can see and act on
// pending requests for their child role(s) — visibility is role-based,
// not assigned-individual-based. Kept as an (empty) list + helper so
// per-role parent assignment can be reintroduced later without
// touching controller logic elsewhere.
const ROLES_REQUIRING_PARENT_SELECTION = [];

// Human readable labels (used in messages/notifications)
const ROLE_LABELS = {
  Admin: 'Admin',
  Radnus: 'Radnus Employee',
  MarketingManager: 'Marketing Manager',
  MarketingExecutive: 'Marketing Executive',
  Distributor: 'Distributor',
  FSE: 'FSE',
  Retailer: 'Retailer',
};

function getApproverRole(role) {
  return ROLE_APPROVER_MAP[role] || null;
}

function requiresApproval(role) {
  return role !== 'Admin' && !!getApproverRole(role);
}

function requiresParentSelection(role) {
  return ROLES_REQUIRING_PARENT_SELECTION.includes(role);
}

// Roles that the given approver role is allowed to approve (children roles)
function getChildRoles(approverRole) {
  return Object.keys(ROLE_APPROVER_MAP).filter(
    (role) => ROLE_APPROVER_MAP[role] === approverRole,
  );
}

module.exports = {
  ROLE_APPROVER_MAP,
  ROLES_REQUIRING_PARENT_SELECTION,
  ROLE_LABELS,
  getApproverRole,
  requiresApproval,
  requiresParentSelection,
  getChildRoles,
};

//++++++++++++++++++++++++++++++++++++++++++++

// const ROLE_APPROVER_MAP = {
//   Radnus: 'Admin',
//   MarketingManager: 'Admin',
//   Distributor: 'MarketingManager',
//   MarketingExecutive: 'MarketingManager',
//   FSE: 'Distributor',
//   Retailer: 'FSE',
// };

// const ROLES_REQUIRING_PARENT_SELECTION = [
//   'Distributor',
//   'MarketingExecutive',
//   'FSE',
//   'Retailer',
// ];

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
