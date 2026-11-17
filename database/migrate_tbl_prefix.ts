/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: Rename all tables to tblPascalCase and id columns to *ID
 * Edit Date: 2026-11-14
 *
 * Run: npx tsx database/migrate_tbl_prefix.ts
 */

import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

type ColRename = { from: string; to: string };
type TableRename = {
  from: string;
  to: string;
  pk?: ColRename;
  columns?: ColRename[];
};

const TABLES: TableRename[] = [
  { from: 'users', to: 'tblUser', pk: { from: 'id', to: 'userID' }, columns: [{ from: 'role_id', to: 'roleID' }] },
  { from: 'user_rights', to: 'tblUserRight', pk: { from: 'id', to: 'userRightID' }, columns: [{ from: 'user_id', to: 'userID' }] },
  { from: 'categories', to: 'tblCategory', pk: { from: 'id', to: 'categoryID' } },
  { from: 'product_types', to: 'tblProductType', pk: { from: 'id', to: 'productTypeID' } },
  { from: 'suppliers', to: 'tblSupplier', pk: { from: 'id', to: 'supplierID' } },
  {
    from: 'products',
    to: 'tblProduct',
    pk: { from: 'id', to: 'productID' },
    columns: [
      { from: 'category_id', to: 'categoryID' },
      { from: 'product_type_id', to: 'productTypeID' },
      { from: 'supplier_id', to: 'supplierID' },
    ],
  },
  { from: 'product_images', to: 'tblProductImage', pk: { from: 'id', to: 'productImageID' }, columns: [{ from: 'product_id', to: 'productID' }] },
  { from: 'product_variants', to: 'tblProductVariant', pk: { from: 'id', to: 'productVariantID' }, columns: [{ from: 'product_id', to: 'productID' }] },
  {
    from: 'cart_items',
    to: 'tblCartItem',
    pk: { from: 'id', to: 'cartItemID' },
    columns: [
      { from: 'user_id', to: 'userID' },
      { from: 'product_id', to: 'productID' },
    ],
  },
  {
    from: 'wishlist',
    to: 'tblWishlist',
    pk: { from: 'id', to: 'wishlistID' },
    columns: [
      { from: 'user_id', to: 'userID' },
      { from: 'product_id', to: 'productID' },
    ],
  },
  {
    from: 'orders',
    to: 'tblOrder',
    pk: { from: 'id', to: 'orderID' },
    columns: [
      { from: 'user_id', to: 'userID' },
      { from: 'warehouse_id', to: 'warehouseID' },
      { from: 'branch_id', to: 'branchID' },
    ],
  },
  {
    from: 'order_items',
    to: 'tblOrderItem',
    pk: { from: 'id', to: 'orderItemID' },
    columns: [
      { from: 'order_id', to: 'orderID' },
      { from: 'product_id', to: 'productID' },
    ],
  },
  {
    from: 'order_status_history',
    to: 'tblOrderStatusHistory',
    pk: { from: 'id', to: 'orderStatusHistoryID' },
    columns: [
      { from: 'order_id', to: 'orderID' },
      { from: 'created_by', to: 'createdByUserID' },
    ],
  },
  { from: 'payment_gateways', to: 'tblPaymentGateway', pk: { from: 'id', to: 'paymentGatewayID' } },
  {
    from: 'billings',
    to: 'tblBilling',
    pk: { from: 'id', to: 'billingID' },
    columns: [
      { from: 'order_id', to: 'orderID' },
      { from: 'user_id', to: 'userID' },
      { from: 'created_by', to: 'createdByUserID' },
    ],
  },
  {
    from: 'pos_payments',
    to: 'tblPosPayment',
    pk: { from: 'id', to: 'posPaymentID' },
    columns: [
      { from: 'billing_id', to: 'billingID' },
      { from: 'order_id', to: 'orderID' },
      { from: 'received_by', to: 'receivedByUserID' },
    ],
  },
  {
    from: 'finance_entries',
    to: 'tblFinanceEntry',
    pk: { from: 'id', to: 'financeEntryID' },
    columns: [{ from: 'created_by', to: 'createdByUserID' }],
  },
  { from: 'dropship_orders', to: 'tblDropshipOrder', pk: { from: 'id', to: 'dropshipOrderID' } },
  { from: 'branches', to: 'tblBranch', pk: { from: 'id', to: 'branchID' } },
  {
    from: 'warehouses',
    to: 'tblWarehouse',
    pk: { from: 'id', to: 'warehouseID' },
    columns: [{ from: 'branch_id', to: 'branchID' }],
  },
  {
    from: 'inventory',
    to: 'tblInventory',
    pk: { from: 'id', to: 'inventoryID' },
    columns: [
      { from: 'product_id', to: 'productID' },
      { from: 'warehouse_id', to: 'warehouseID' },
      { from: 'variant_id', to: 'productVariantID' },
    ],
  },
  {
    from: 'stock_movements',
    to: 'tblStockMovement',
    pk: { from: 'id', to: 'stockMovementID' },
    columns: [
      { from: 'product_id', to: 'productID' },
      { from: 'warehouse_id', to: 'warehouseID' },
      { from: 'from_warehouse_id', to: 'fromWarehouseID' },
      { from: 'to_warehouse_id', to: 'toWarehouseID' },
      { from: 'variant_id', to: 'productVariantID' },
      { from: 'created_by', to: 'createdByUserID' },
      { from: 'order_id', to: 'orderID' },
    ],
  },
  { from: 'staff_profile', to: 'tblStaffProfile', pk: { from: 'id', to: 'staffProfileID' }, columns: [{ from: 'user_id', to: 'userID' }] },
  { from: 'staff_education', to: 'tblStaffEducation', pk: { from: 'id', to: 'staffEducationID' }, columns: [{ from: 'user_id', to: 'userID' }] },
  { from: 'staff_experience', to: 'tblStaffExperience', pk: { from: 'id', to: 'staffExperienceID' }, columns: [{ from: 'user_id', to: 'userID' }] },
  { from: 'staff_documents', to: 'tblStaffDocument', pk: { from: 'id', to: 'staffDocumentID' }, columns: [{ from: 'user_id', to: 'userID' }] },
  {
    from: 'staff_history',
    to: 'tblStaffHistory',
    pk: { from: 'id', to: 'staffHistoryID' },
    columns: [
      { from: 'user_id', to: 'userID' },
      { from: 'changed_by', to: 'changedByUserID' },
    ],
  },
];

async function tableExists(db: any, name: string) {
  const [rows] = await db.query(
    `SELECT 1 AS ok FROM information_schema.tables
     WHERE table_schema = DATABASE() AND LOWER(table_name) = LOWER(?) LIMIT 1`,
    [name]
  );
  return rows.length > 0;
}

async function columnExists(db: any, table: string, column: string) {
  const [rows] = await db.query(
    `SELECT 1 AS ok FROM information_schema.columns
     WHERE table_schema = DATABASE() AND LOWER(table_name) = LOWER(?) AND column_name = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function dropAllForeignKeys(db: any) {
  const [fks] = await db.query(
    `SELECT TABLE_NAME, CONSTRAINT_NAME
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'`
  );
  for (const fk of fks as any[]) {
    await db.query(`ALTER TABLE \`${fk.TABLE_NAME}\` DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
    console.log(`dropped FK ${fk.TABLE_NAME}.${fk.CONSTRAINT_NAME}`);
  }
}

async function renameColumn(db: any, table: string, from: string, to: string) {
  if (await columnExists(db, table, to) && !(await columnExists(db, table, from))) {
    console.log(`  skip ${table}.${from} (already ${to})`);
    return;
  }
  if (!(await columnExists(db, table, from))) {
    console.log(`  skip ${table}.${from} (missing)`);
    return;
  }
  if (from === to) return;

  const [cols] = await db.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [from]);
  if (!cols.length) return;
  const col = cols[0];

  let sql = `ALTER TABLE \`${table}\` CHANGE \`${from}\` \`${to}\` ${col.Type}`;
  sql += col.Null === 'YES' ? ' NULL' : ' NOT NULL';

  if (String(col.Extra || '').includes('auto_increment')) {
    sql += ' AUTO_INCREMENT';
  } else if (col.Default !== null && col.Default !== undefined) {
    if (String(col.Default).toUpperCase() === 'CURRENT_TIMESTAMP') {
      sql += ' DEFAULT CURRENT_TIMESTAMP';
    } else {
      sql += ` DEFAULT ${mysql.escape(col.Default)}`;
    }
  } else if (col.Null === 'YES') {
    sql += ' DEFAULT NULL';
  }

  if (String(col.Extra || '').toLowerCase().includes('on update')) {
    sql += ' ON UPDATE CURRENT_TIMESTAMP';
  }

  await db.query(sql);
  console.log(`  col ${table}.${from} -> ${to}`);
}

async function run() {
  const db: any = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'garments_shop',
    multipleStatements: true,
  });

  console.log('Migrating to tbl* / *ID naming…');
  await db.query('SET FOREIGN_KEY_CHECKS = 0');
  await dropAllForeignKeys(db);

  // Legacy roles table vs existing tblRole
  if (await tableExists(db, 'tblRole') || (await tableExists(db, 'tblrole'))) {
    if (await tableExists(db, 'roles')) {
      await db.query('DROP TABLE `roles`');
      console.log('Dropped legacy roles');
    }
  } else if (await tableExists(db, 'roles')) {
    await db.query('RENAME TABLE `roles` TO `tblRole`');
    console.log('Renamed roles -> tblRole');
  }

  if (await tableExists(db, 'tblRole') || (await tableExists(db, 'tblrole'))) {
    if (await columnExists(db, 'tblRole', 'RoleId')) {
      await renameColumn(db, 'tblRole', 'RoleId', 'roleID');
    } else if (await columnExists(db, 'tblRole', 'id')) {
      await renameColumn(db, 'tblRole', 'id', 'roleID');
    }
  }

  for (const t of TABLES) {
    const hasFrom = await tableExists(db, t.from);
    const hasTo = await tableExists(db, t.to);

    if (hasFrom && !hasTo) {
      await db.query(`RENAME TABLE \`${t.from}\` TO \`${t.to}\``);
      console.log(`table ${t.from} -> ${t.to}`);
    } else if (!hasFrom && hasTo) {
      console.log(`table ${t.to} already present`);
    } else if (hasFrom && hasTo) {
      await db.query(`DROP TABLE \`${t.from}\``);
      console.log(`dropped duplicate ${t.from}`);
    } else {
      console.log(`skip missing ${t.from}`);
      continue;
    }

    const cols = [...(t.columns || [])].sort((a, b) => b.from.length - a.from.length);
    for (const c of cols) await renameColumn(db, t.to, c.from, c.to);
    if (t.pk) await renameColumn(db, t.to, t.pk.from, t.pk.to);
  }

  await db.query('SET FOREIGN_KEY_CHECKS = 1');

  const [tables] = await db.query('SHOW TABLES');
  console.log(
    'Tables now:',
    (tables as any[]).map((r) => Object.values(r)[0]).join(', ')
  );
  await db.end();
  console.log('Done.');
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
