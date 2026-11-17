/**
 * One-shot helper: copy .js → .ts with headers and basic CJS→ESM export fixes.
 * Run from garments-shop: node scripts/js-to-ts-convert.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDIT_DATE = '2026-11-12';

const DESC = {
  'server.ts': 'Express API entrypoint for Buildnex Kadai',
  'config/db.ts': 'MySQL connection pool configuration',
  'config/modules.ts': 'Panel ACL module keys and full admin rights helper',
  'config/roles.ts': 'Default role level definitions for staff hierarchy',
  'utils/helpers.ts': 'Shared HTTP helpers, slugify, pricing and order numbers',
  'utils/stockService.ts': 'Inventory stock queries, movements and reports',
  'utils/orderWorkflow.ts': 'Order status workflow and POS stock finalization',
  'middleware/auth.ts': 'JWT auth, panel access and module rights middleware',
  'middleware/upload.ts': 'Multer product image upload middleware',
  'middleware/supportUpload.ts': 'Multer support ticket attachment upload middleware',
  'routes/index.ts': 'API route table for auth, shop and panel endpoints',
  'controllers/authController.ts': 'Login, register, profile and session handlers',
  'controllers/wishlistController.ts': 'Customer wishlist API handlers',
  'controllers/cartController.ts': 'Shopping cart API handlers',
  'controllers/shopController.ts': 'Public shop catalog and product handlers',
  'controllers/orderController.ts': 'Customer order place/list/detail/cancel handlers',
  'controllers/posController.ts': 'POS lookup and checkout handlers',
  'controllers/supportController.ts': 'Help center and support ticket handlers',
  'controllers/adminController.ts': 'Admin dashboard, products, stock and orders',
  'controllers/panelController.ts': 'Panel CRUD for staff, roles, finance and reports',
  'database/setup.ts': 'Initial database schema and seed setup',
};

function headerFor(rel) {
  const desc =
    DESC[rel.replace(/\\/g, '/')] ||
    (rel.includes('migrate_')
      ? `Database migration: ${path.basename(rel, '.ts')}`
      : `Buildnex Kadai API module: ${path.basename(rel)}`);
  return `/**
 * Author: Nandhakumar
 * Version: 0.0.1
 * Desc: ${desc}
 * Edit Date: ${EDIT_DATE}
 */

`;
}

function convertSource(code) {
  let out = code;

  // const { a, b } = require('x');
  out = out.replace(
    /const\s*\{\s*([^}]+)\s*\}\s*=\s*require\((['"`][^'"`]+['"`])\);?/g,
    'import { $1 } from $2;'
  );

  // const name = require('x');
  out = out.replace(
    /const\s+(\w+)\s*=\s*require\((['"`][^'"`]+['"`])\);?/g,
    'import $1 from $2;'
  );

  // exports.name = ...
  out = out.replace(/^exports\.(\w+)\s*=/gm, 'export const $1 =');

  // module.exports = { a, b, c };
  out = out.replace(/module\.exports\s*=\s*\{([^}]+)\};?/g, (_m, body) => {
    const names = body
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(':')[0].trim());
    return `export { ${names.join(', ')} };`;
  });

  // module.exports = something;
  out = out.replace(/module\.exports\s*=\s*([^;]+);?/g, 'export default $1;');

  // Fix relative imports missing extension is fine for TS
  // Fix .js require paths already handled

  return out;
}

function walk(dir, files = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'scripts') continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (name.endsWith('.js') && name !== 'js-to-ts-convert.mjs') files.push(full);
  }
  return files;
}

const files = walk(root);
for (const file of files) {
  const relJs = path.relative(root, file);
  const relTs = relJs.replace(/\.js$/i, '.ts');
  const absTs = path.join(root, relTs);
  const raw = fs.readFileSync(file, 'utf8');
  if (raw.startsWith('/**\n * Author: Nandhakumar')) {
    console.log('skip already headed', relTs);
    continue;
  }
  const converted = convertSource(raw);
  const final = headerFor(relTs) + converted;
  fs.writeFileSync(absTs, final, 'utf8');
  console.log('wrote', relTs);
}

console.log(`Converted ${files.length} files`);
