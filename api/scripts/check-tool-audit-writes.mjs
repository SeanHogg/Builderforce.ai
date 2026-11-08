#!/usr/bin/env node
/**
 * Tool-audit write guard - `tool_audit_events` is inserted ONLY through `insertToolAudit`
 * (`application/audit/toolAuditWrite.ts`), which redacts secret-shaped values in `args` / `result`
 * immediately before the insert. A direct `insert(toolAuditEvents)` is a second writer that can store
 * an `env` dump, a bearer header or a token verbatim.
 *
 * Not a ratchet: the allow-list is the helper itself plus the explicit exceptions below, each with
 * the reason it is safe. Tests are not scanned.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

/** file (relative to src, POSIX) -> why a direct write is allowed there. */
const ALLOWED = new Map([
  ['application/audit/toolAuditWrite.ts', 'the writer itself'],
]);

const TABLE = 'toolAuditEvents';
/** Raw SQL writes: `INSERT INTO tool_audit_events` / `UPDATE tool_audit_events` in a sql template or a db.execute string. */
const RAW_WRITE = /\b(?:insert\s+into|update)\s+(?:"?[\w]+"?\.)?"?tool_audit_events"?/gi;

/**
 * Every local name the table can be written through: the export itself (`toolAuditEvents`, `schema.toolAuditEvents`),
 * an aliased import (`import { toolAuditEvents as t }`), and a variable bound to it (`const t = toolAuditEvents`).
 */
function tableNames(text) {
  const names = new Set([TABLE]);
  for (const m of text.matchAll(new RegExp(`\\b${TABLE}\\s+as\\s+(\\w+)`, 'g'))) names.add(m[1]);
  for (const m of text.matchAll(new RegExp(`\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:\\w+\\.)?${TABLE}\\b(?!\\s*[.(\\[])`, 'g'))) names.add(m[1]);
  return [...names];
}

/** Offsets of every write to the table in `text`: `insert(<name>)`, `update(<name>).set(`, raw INSERT/UPDATE SQL. */
function writeOffsets(text) {
  const offsets = [];
  const names = tableNames(text).map((n) => `(?:\\w+\\.)?${n}`).join('|');
  for (const re of [new RegExp(`\\binsert\\(\\s*(?:${names})\\s*\\)`, 'g'), RAW_WRITE]) {
    for (const m of text.matchAll(re)) offsets.push(m.index);
  }
  // An UPDATE can store a secret only by writing `args` / `result`; blanking them (`{ args: null, result: null }`, the retention
  // sweep) or touching other columns stores nothing.
  for (const m of text.matchAll(new RegExp(`\\bupdate\\(\\s*(?:${names})\\s*\\)\\s*\\.set\\(`, 'g'))) {
    const setBody = text.slice(m.index + m[0].length, m.index + m[0].length + 400).split(/\)\s*\.(?:where|returning)\b/)[0];
    if (/\b(?:args|result)\s*:(?!\s*null\b)/.test(setBody)) offsets.push(m.index);
  }
  return offsets;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (name !== 'node_modules') yield* walk(path); } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) yield path;
  }
}

const violations = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  if (ALLOWED.has(rel)) continue;
  const text = readFileSync(file, 'utf8');
  for (const offset of writeOffsets(text)) {
    const line = text.slice(0, offset).split('\n').length;
    violations.push(`${rel}:${line}`);
  }
}

if (violations.length > 0) {
  console.error('Tool-audit write guard: tool_audit_events is inserted outside insertToolAudit:\n');
  for (const v of violations) console.error(`   ${v}`);
  console.error('\nUse `insertToolAudit(db, row | rows)` (application/audit/toolAuditWrite.ts): it redacts args/result before the insert. An UPDATE of args/result is a second writer too.');
  process.exit(1);
}
console.log('Tool-audit write guard OK - no tool_audit_events insert/update outside the writer.');
