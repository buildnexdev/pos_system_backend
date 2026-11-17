/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Panel ACL module keys and full admin rights helper
 * Edit Date: 2026-11-12
 */

export interface PanelModule {
  key: string;
  label: string;
}

export interface ModuleRight {
  module_key: string;
  can_view: number;
  can_create: number;
  can_edit: number;
  can_delete: number;
}

const MODULES: PanelModule[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'role', label: 'Role' },
  { key: 'access_control', label: 'Access Control' },
  { key: 'staff', label: 'Staff' },
  { key: 'company', label: 'Company' },
  { key: 'payment_history', label: 'Payment History' },
  { key: 'invoice_agreement', label: 'Invoice & Agreement' },
  { key: 'manage_ticket', label: 'Manage Ticket' },
  { key: 'product_type', label: 'Product Type' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'branch', label: 'Branch' },
  { key: 'warehouse', label: 'Warehouse' },
  { key: 'catalog', label: 'Products' },
  { key: 'product', label: 'Stock' },
  { key: 'order', label: 'Order' },
  { key: 'customer', label: 'Customer' },
  { key: 'payment_gateway', label: 'Payment Gateway' },
  { key: 'billing', label: 'POS Billing' },
  { key: 'dropshipping', label: 'Dropshipping' },
  { key: 'report', label: 'Report' },
  { key: 'finance', label: 'Finance' },
  { key: 'support', label: 'Help & Support' },
];

/** Platform Super Admin menu / API modules */
const SUPER_ADMIN_MODULE_KEYS = new Set([
  'company',
  'payment_history',
  'invoice_agreement',
  'manage_ticket',
  'support', // Manage Ticket APIs
]);

function fullRights(): ModuleRight[] {
  return MODULES.map((m) => ({
    module_key: m.key,
    can_view: 1,
    can_create: 1,
    can_edit: 1,
    can_delete: 1,
  }));
}

/** Super Admin: Company + billing/support platform pages */
function companyOnlyRights(): ModuleRight[] {
  return MODULES.map((m) => {
    const on = SUPER_ADMIN_MODULE_KEYS.has(m.key) ? 1 : 0;
    return {
      module_key: m.key,
      can_view: on,
      can_create: on,
      can_edit: on,
      can_delete: on,
    };
  });
}

/** Company Admin: full panel except Super Admin–only pages */
function companyAdminRights(): ModuleRight[] {
  return MODULES.map((m) => {
    const blocked = SUPER_ADMIN_MODULE_KEYS.has(m.key) && m.key !== 'support';
    const on = blocked ? 0 : 1;
    return {
      module_key: m.key,
      can_view: on,
      can_create: on,
      can_edit: on,
      can_delete: on,
    };
  });
}

export { MODULES, SUPER_ADMIN_MODULE_KEYS, fullRights, companyOnlyRights, companyAdminRights };
