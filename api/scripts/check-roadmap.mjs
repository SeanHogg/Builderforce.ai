#!/usr/bin/env node
/** Fail CI when ROADMAP's machine-counted index and grouped bodies drift apart. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const text = readFileSync(resolve(here, '../../ROADMAP.md'), 'utf8');
const index = new Map();
for (const match of text.matchAll(/^\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*$/gm)) {
  index.set(Number(match[1]), Number(match[2]));
}

const starts = [];
const groupZero = text.indexOf('### PRD 20 · Consolidated data model');
if (groupZero >= 0) starts.push({ group: 0, offset: groupZero });
for (const match of text.matchAll(/^## (\d+) · /gm)) {
  starts.push({ group: Number(match[1]), offset: match.index });
}
starts.sort((a, b) => a.offset - b.offset);

const errors = [];
for (let group = 0; group <= 15; group += 1) {
  const at = starts.findIndex((entry) => entry.group === group);
  if (at < 0) { errors.push(`group ${group}: body heading is missing`); continue; }
  if (!index.has(group)) { errors.push(`group ${group}: exact-count index row is missing`); continue; }
  const body = text.slice(starts[at].offset, starts[at + 1]?.offset ?? text.length);
  const count = (body.match(/^- \*\*/gm) ?? []).length;
  if (count !== index.get(group)) errors.push(`group ${group}: index says ${index.get(group)}, body has ${count}`);
}

if (errors.length) {
  console.error('❌ ROADMAP register mismatch:\n');
  for (const error of errors) console.error(`   - ${error}`);
  console.error('\nUpdate the exact-count index and body in the same change.');
  process.exit(1);
}
console.log('✅ ROADMAP register OK — groups 0–15 and exact open-item counts match.');
