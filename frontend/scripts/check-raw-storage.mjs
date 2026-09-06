#!/usr/bin/env node
/**
 * Raw browser-storage ratchet.
 *
 * `lib/storage.ts` is THE door to localStorage: it never throws (Safari private
 * mode, sandboxed frames, the server, quota) and returns `null`/`false` where a
 * raw call would have taken the component down. Every remaining direct
 * `localStorage.` / `sessionStorage.` access is one of those crash sites.
 *
 * A ratchet rather than a ban, because 130-odd sites predate the door: the
 * count may only fall. `node scripts/check-raw-storage.mjs --update` re-locks
 * the baseline after a migration.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');
const baselinePath = resolve(here, '.raw-storage-baseline.json');
const update = process.argv.includes('--update');

const ALLOWED = new Set(['lib/storage.ts']);
const RAW = /\b(localStorage|sessionStorage)\./;

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const sites = [];
for (const file of collect(srcDir)) {
  const rel = relative(srcDir, file).split('\\').join('/');
  if (ALLOWED.has(rel) || /\.test\.tsx?$/.test(rel)) continue;
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (/^\s*[*]/.test(line)) return;
    const code = line.replace(/\/\/.*$/, '');
    if (RAW.test(code)) sites.push(`${rel}:${i + 1}`);
  });
}

let baseline = null;
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).count;
} catch {
  baseline = null;
}

if (update || baseline === null) {
  writeFileSync(baselinePath, JSON.stringify({ count: sites.length }, null, 2) + '\n');
  console.log(`✅  Raw storage baseline ${baseline === null ? 'written' : 'updated'}: ${sites.length} site(s).`);
  process.exit(0);
}

if (sites.length > baseline) {
  console.error(`❌  Raw localStorage/sessionStorage access grew: ${sites.length} site(s), baseline ${baseline}.\n`);
  for (const site of sites) console.error('  - ' + site);
  console.error("\n   Use readLocal / writeLocal / readLocalJson / writeLocalJson from '@/lib/storage' — it never throws.\n");
  process.exit(1);
}

if (sites.length < baseline) {
  writeFileSync(baselinePath, JSON.stringify({ count: sites.length }, null, 2) + '\n');
  console.log(`✅  Raw storage access shrank to ${sites.length} site(s) (was ${baseline}); baseline re-locked.`);
} else {
  console.log(`✅  Raw storage access held at ${sites.length} site(s).`);
}
