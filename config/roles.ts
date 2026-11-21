/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Default role level definitions for staff hierarchy
 * Edit Date: 2026-11-12
 */

export interface DefaultRole {
  level: number;
  code: string;
  name: string;
  description: string;
  color: string;
}

const DEFAULT_ROLES: DefaultRole[] = [
  {
    level: 1,
    code: 'owner',
    name: 'Owner / Super Admin',
    description: 'Complete business and system control',
    color: '#7c3aed',
  },
  {
    level: 2,
    code: 'admin_manager',
    name: 'Admin / Manager',
    description: 'Overall store and employee management',
    color: '#2563eb',
  },
  {
    level: 3,
    code: 'store_manager',
    name: 'Store Manager',
    description: 'Daily store operations and sales',
    color: '#0f766e',
  },
  {
    level: 4,
    code: 'inventory_manager',
    name: 'Inventory Manager',
    description: 'Products, stock, sizes and variants',
    color: '#ea580c',
  },
  {
    level: 5,
    code: 'order_manager',
    name: 'Order Manager',
    description: 'Orders, delivery, returns and exchanges',
    color: '#db2777',
  },
  {
    level: 6,
    code: 'sales_executive',
    name: 'Sales Executive',
    description: 'Customer support and sales operations',
    color: '#0284c7',
  },
  {
    level: 7,
    code: 'staff_viewer',
    name: 'Staff / Viewer',
    description: 'Limited access for viewing and basic tasks',
    color: '#64748b',
  },
];

/** L1 Owner / L2 Admin stay system-only — not shown or assignable in Roles / Staff UI */
export const ASSIGNABLE_ROLE_MIN_LEVEL = 3;

export function isAssignableStaffRoleLevel(level: number | null | undefined) {
  const n = Number(level);
  return Number.isFinite(n) && n >= ASSIGNABLE_ROLE_MIN_LEVEL && n < 90;
}

/** Levels available when creating/editing company roles in the panel */
export const ASSIGNABLE_DEFAULT_ROLES = DEFAULT_ROLES.filter((r) =>
  isAssignableStaffRoleLevel(r.level)
);

export { DEFAULT_ROLES };
