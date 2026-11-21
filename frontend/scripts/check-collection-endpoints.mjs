#!/usr/bin/env node
/**
 * check:collection-endpoints (PRD 47 §7) — every `useServerSource(` call site
 * must have a fetcher that passes `page` through to the endpoint. A fetcher that
 * ignores `page` renders page 1 forever.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
const SKIP = /(\.test\.|\.spec\.|__tests__|node_modules|components[\\/]collection[\\/]sources\.ts$)/;

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

/** The text of the balanced call starting at the `(` after `useServerSource`. */
function callBody(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(from, i + 1);
  }
  return src.slice(from);
}

const failures = [];
for (const file of walk(root)) {
  const src = readFileSync(file, 'utf8');
  let idx = src.indexOf('useServerSource(');
  while (idx !== -1) {
    const body = callBody(src, idx + 'useServerSource'.length);
    if (!/\bpage\b/.test(body)) failures.push(relative(root, file));
    idx = src.indexOf('useServerSource(', idx + 1);
  }
}

if (failures.length) {
  console.error('check:collection-endpoints — useServerSource fetcher must pass `page`:');
  for (const f of new Set(failures)) console.error(`  src/${f}`);
  process.exit(1);
}
console.log('check:collection-endpoints OK');
