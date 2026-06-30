// utils/roleHierarchy.js
const ROLE_APPROVER_MAP = {
  Radnus: 'Admin',
  MarketingManager: 'Admin',
  Distributor: 'MarketingManager',
  MarketingExecutive: 'MarketingManager',
  FSE: 'Distributor',
  Retailer: 'FSE',
};

const ROLES_REQUIRING_PARENT_SELECTION = [
  'Distributor',
  'MarketingExecutive',
  'FSE',
  'Retailer',
];

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

//+++++++++++++++++++++++++++++++

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
