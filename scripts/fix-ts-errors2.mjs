import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', 'dist', 'scripts'].includes(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

for (const file of walk(root)) {
  let c = fs.readFileSync(file, 'utf8');
  const orig = c;
  c = c.replace(/\(options = \{\}/g, '(options: any = {}');
  c = c.replace(/\(filters = \{\}/g, '(filters: any = {}');
  c = c.replace(/\(query = \{\}/g, '(query: any = {}');
  c = c.replace(/\(payload = \{\}/g, '(payload: any = {}');
  c = c.replace(/\(data = \{\}/g, '(data: any = {}');
  c = c.replace(/const patch = \{/g, 'const patch: any = {');
  c = c.replace(/connection = null\)/g, 'connection: any = null)');
  // leftover createConnection without any
  c = c.replace(/const ([a-zA-Z]+) = await mysql\.createConnection\(/g, 'const $1: any = await mysql.createConnection(');
  // QueryResult from mysql2 without any cast - wrap query helpers in migrations that use raw connection
  if (file.includes(`${path.sep}database${path.sep}`)) {
    // ensure createPool also any if present
    c = c.replace(/const ([a-zA-Z]+) = await mysql\.createPool\(/g, 'const $1: any = await mysql.createPool(');
  }
  if (c !== orig) {
    fs.writeFileSync(file, c);
    console.log('fixed', path.relative(root, file));
  }
}
console.log('done');
