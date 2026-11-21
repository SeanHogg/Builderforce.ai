#!/usr/bin/env node
/**
 * check:bulk-fanout (PRD 47 §7) — fails on per-id bulk fan-out against an API
 * client: `Promise.all(<ids>.map(` or a for-of loop that awaits an `*Api.` call.
 * Bulk actions are ONE `collectionsApi.bulk` request (the F6 429 regression).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
const SKIP = /(\.test\.|\.spec\.|__tests__|node_modules)/;
const FANOUT = [
  /Promise\.all(?:Settled)?\(\s*\w*[iI]ds\w*\s*\.map\(/,
  /for\s*\(\s*(?:const|let)\s+\w+\s+of\s+\w*[iI]ds\w*\s*\)\s*\{?[^}]*await\s+\w*Api\./s,
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP.test(p)) continue;
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const failures = [];
for (const file of walk(root)) {
  const src = readFileSync(file, 'utf8');
  if (FANOUT.some((re) => re.test(src))) failures.push(relative(root, file));
}

if (failures.length) {
  console.error('check:bulk-fanout — per-id fan-out found (use collectionsApi.bulk, one request):');
  for (const f of failures) console.error(`  src/${f}`);
  process.exit(1);
}
console.log('check:bulk-fanout OK');
