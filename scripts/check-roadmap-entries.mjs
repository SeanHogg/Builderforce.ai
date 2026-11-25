#!/usr/bin/env node
/**
 * check-roadmap-entries — the roadmap is data, so it is checked like data.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────────
 * A roadmap that names an entry nobody can find, or depends on one that does not exist,
 * is fiction with a table of contents. ROADMAP.md, the ten program files in
 * docs/roadmap/ and GAP-REGISTER.md are held to one contract:
 *
 *   • every ```yaml roadmap block has a unique id whose prefix is its program's;
 *   • priority and status come from a closed set;
 *   • every dependency names an entry that exists, and dependencies do not loop;
 *   • `blocked` names a blocker and nothing else does ("no blocker named means not blocked");
 *   • the execution order in ROADMAP.md cites only real entry ids, ranked 1..N without a gap;
 *   • every top-level gap-register line carries a `PROGRAM-Gnnn` id with a known prefix.
 *
 * The block is flat YAML (scalars and string lists), parsed here without a dependency.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roadmapDir = path.join(repoRoot, 'docs', 'roadmap');

/** Entry-id prefix → the `program:` slug every entry with that prefix carries. */
const PROGRAMS = {
  WC: 'webcontainers',
  AE: 'autonomous-execution',
  AVR: 'agent-virtualization',
  SEC: 'security-shield',
  REL: 'reliability-release',
  HOST: 'application-hosting',
  AI: 'local-ai-runtime',
  MEM: 'evermind-knowledge',
  UX: 'execution-experience',
  COM: 'commercialization',
};
const GAP_PREFIXES = [...Object.keys(PROGRAMS), 'MAINT', 'DEFER'];
const PRIORITIES = new Set(['P0', 'P1', 'P2']);
const STATUSES = new Set(['planned', 'in-progress', 'blocked', 'done']);

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);

/** Lines of `text` outside fenced code blocks, as [lineNumber, line]. */
function* unfenced(text) {
  let fenced = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) yield [i + 1, lines[i]];
  }
}

/** Flat YAML: `key: scalar`, `key:` followed by `  - item` lines, or `key: []`. */
function parseBlock(block) {
  const entry = {};
  let listKey = null;
  for (const line of block.split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      entry[listKey].push(item[1].trim());
      continue;
    }
    const kv = /^([a-z]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === '' || value === '[]') {
      entry[key] = [];
      listKey = value === '' ? key : null;
    } else {
      entry[key] = value === 'null' ? null : value;
      listKey = null;
    }
  }
  return entry;
}

const entries = new Map();
const programFiles = fs.readdirSync(roadmapDir).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();
for (const file of programFiles) {
  const text = fs.readFileSync(path.join(roadmapDir, file), 'utf8');
  for (const match of text.matchAll(/```yaml roadmap\r?\n([\s\S]*?)```/g)) {
    const entry = parseBlock(match[1]);
    const where = `${file} ${entry.id ?? '(no id)'}`;
    const prefix = /^([A-Z]+)-\d{2}$/.exec(entry.id ?? '')?.[1];
    if (!prefix || !(prefix in PROGRAMS)) {
      fail(where, `id must be PREFIX-nn with a prefix from ${Object.keys(PROGRAMS).join(', ')}`);
      continue;
    }
    if (entries.has(entry.id)) fail(where, 'duplicate id');
    if (entry.program !== PROGRAMS[prefix]) fail(where, `program must be \`${PROGRAMS[prefix]}\` for prefix ${prefix}`);
    if (!PRIORITIES.has(entry.priority)) fail(where, `priority \`${entry.priority}\` is not one of ${[...PRIORITIES]}`);
    if (!STATUSES.has(entry.status)) fail(where, `status \`${entry.status}\` is not one of ${[...STATUSES]}`);
    if (entry.status === 'blocked' && !entry.blocker) fail(where, 'is blocked but names no blocker');
    if (entry.status !== 'blocked' && entry.blocker) fail(where, 'names a blocker but is not `blocked`');
    entries.set(entry.id, entry);
  }
}

for (const entry of entries.values()) {
  for (const dep of entry.dependencies ?? []) {
    if (!entries.has(dep)) fail(entry.id, `depends on \`${dep}\`, which does not exist`);
  }
}

// A dependency loop can never be scheduled. Depth-first with the current trail.
const settled = new Set();
function visit(id, trail) {
  if (settled.has(id) || !entries.has(id)) return;
  if (trail.includes(id)) {
    fail(id, `dependency cycle ${[...trail.slice(trail.indexOf(id)), id].join(' → ')}`);
    return;
  }
  for (const dep of entries.get(id).dependencies ?? []) visit(dep, [...trail, id]);
  settled.add(id);
}
for (const id of entries.keys()) visit(id, []);

// The execution order: a table under "Immediate execution order", ranked 1..N, citing real ids.
const roadmapText = fs.readFileSync(path.join(repoRoot, 'ROADMAP.md'), 'utf8');
const orderStart = roadmapText.search(/^## Immediate execution order/m);
if (orderStart < 0) {
  fail('ROADMAP.md', 'has no "## Immediate execution order" section');
} else {
  const afterHeading = roadmapText.slice(orderStart).split(/\r?\n/).slice(1);
  const nextHeading = afterHeading.findIndex((l) => l.startsWith('## '));
  const rows = nextHeading < 0 ? afterHeading : afterHeading.slice(0, nextHeading);
  const ranks = [];
  for (const row of rows) {
    const rank = /^\|\s*(\d+)\s*\|/.exec(row)?.[1];
    if (!rank) continue;
    ranks.push(Number(rank));
    const ids = row.match(/\b[A-Z]+-\d{2}\b/g) ?? [];
    if (ids.length === 0) fail(`ROADMAP.md rank ${rank}`, 'cites no entry id');
    for (const id of ids) if (!entries.has(id)) fail(`ROADMAP.md rank ${rank}`, `cites \`${id}\`, which does not exist`);
  }
  if (ranks.length === 0 || ranks.some((r, i) => r !== i + 1)) {
    fail('ROADMAP.md', `execution order ranks must run 1..N without a gap (found ${ranks.join(', ') || 'none'})`);
  }
}

// Every top-level gap line is addressable.
const gapIds = new Set();
const gapPrefixPattern = new RegExp(`^- \`(${GAP_PREFIXES.join('|')})-G(\\d{3})\` `);
const gapText = fs.readFileSync(path.join(roadmapDir, 'GAP-REGISTER.md'), 'utf8');
for (const [lineNumber, line] of unfenced(gapText)) {
  if (!line.startsWith('- ')) continue;
  const id = gapPrefixPattern.exec(line);
  if (!id) {
    fail(`GAP-REGISTER.md:${lineNumber}`, `entry has no \`PROGRAM-Gnnn\` id (${GAP_PREFIXES.join(', ')})`);
    continue;
  }
  const key = `${id[1]}-G${id[2]}`;
  if (gapIds.has(key)) fail(`GAP-REGISTER.md:${lineNumber}`, `duplicate gap id ${key}`);
  gapIds.add(key);
}

if (problems.length > 0) {
  console.error('Roadmap entries:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\n${problems.length} problem(s). See scripts/check-roadmap-entries.mjs.`);
  process.exit(1);
}
console.log(`check-roadmap-entries: OK (${entries.size} program entries, ${gapIds.size} gap entries)`);
