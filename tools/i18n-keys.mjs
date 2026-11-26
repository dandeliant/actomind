// Lists translation keys used in js/ (static) and dynamic key prefixes.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', 'js');
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (!p.includes('i18n')) walk(p); } else if (p.endsWith('.js')) files.push(p); } })(root);
const stat = new Set();
const dyn = new Set();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\bt[n]?\(\s*'([^']+)'\s*([,)])/g)) stat.add(m[1]);
  for (const m of s.matchAll(/\bt[n]?\(\s*'([^']+)'\s*\+/g)) dyn.add(m[1] + '*  ' + path.basename(f));
  for (const m of s.matchAll(/\bt[n]?\(\s*`([^`]+)`/g)) dyn.add('`' + m[1] + '`  ' + path.basename(f));
}
export const STATIC_KEYS = [...stat].sort();
if (process.argv[2] === '--print') {
  console.log(STATIC_KEYS.join('\n'));
  console.log('\n--- dynamic ---');
  console.log([...dyn].sort().join('\n'));
}
