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

export { DEFAULT_ROLES };
