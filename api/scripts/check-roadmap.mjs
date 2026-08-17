#!/usr/bin/env node
/**
 * Fail CI when ROADMAP's machine-counted index and grouped bodies drift apart.
 *
 * ROADMAP.md has active concurrent writers — a bullet landing in group N from one
 * change and the index row from another is not a defect in either change, just two
 * edits to the same duplicated fact landing out of order. `--update` recounts every
 * group's body and rewrites the index to match, the same escape hatch
 * `check-shape-lint.mjs --update` gives its own baseline, so a drift is a one-command
 * fix instead of a hand-count each time it is hit.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const roadmapPath = resolve(here, '../../ROADMAP.md');
const text = readFileSync(roadmapPath, 'utf8');
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

const update = process.argv.includes('--update');
const errors = [];
const corrections = [];
for (let group = 0; group <= 15; group += 1) {
  const at = starts.findIndex((entry) => entry.group === group);
  if (at < 0) { errors.push(`group ${group}: body heading is missing`); continue; }
  const body = text.slice(starts[at].offset, starts[at + 1]?.offset ?? text.length);
  const count = (body.match(/^- \*\*/gm) ?? []).length;
  if (!index.has(group)) {
    if (!update) errors.push(`group ${group}: exact-count index row is missing`);
    continue;
  }
  if (count !== index.get(group)) {
    if (update) corrections.push({ group, from: index.get(group), to: count });
    else errors.push(`group ${group}: index says ${index.get(group)}, body has ${count}`);
  }
}

if (update) {
  if (!corrections.length) {
    console.log('✅ ROADMAP register already matches — nothing to update.');
  } else {
    let next = text;
    for (const { group, to } of corrections) {
      next = next.replace(new RegExp(`^\\|\\s*${group}\\s*\\|\\s*\\d+\\s*\\|\\s*$`, 'm'), `| ${group} | ${to} |`);
    }
    writeFileSync(roadmapPath, next);
    console.log(`✅ Updated ${corrections.length} index row(s):`);
    for (const { group, from, to } of corrections) console.log(`   - group ${group}: ${from} → ${to}`);
  }
  process.exit(0);
}

if (errors.length) {
  console.error('❌ ROADMAP register mismatch:\n');
  for (const error of errors) console.error(`   - ${error}`);
  console.error('\nUpdate the exact-count index and body in the same change, or run `node scripts/check-roadmap.mjs --update`.');
  process.exit(1);
}
console.log('✅ ROADMAP register OK — groups 0–15 and exact open-item counts match.');
