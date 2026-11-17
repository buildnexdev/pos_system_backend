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
  c = c.replace(/\} = \{\}\)/g, '}: any = {})');
  c = c.replace(/\} = \{\},/g, '}: any = {},');
  c = c.replace(/const params = \{ tenant \}/g, 'const params: any = { tenant }');
  c = c.replace(/const params = \{ id:/g, 'const params: any = { id:');
  c = c.replace(/new Map\(/g, 'new Map<string, any>(');
  c = c.replace(/const db = await mysql\.createConnection\(/g, 'const db: any = await mysql.createConnection(');
  c = c.replace(/export \{ supportUpload, supportUploadDir \};/g, 'export { supportUpload, uploadDir as supportUploadDir };');
  if (c !== orig) {
    fs.writeFileSync(file, c);
    console.log('fixed', path.relative(root, file));
  }
}
console.log('done');
