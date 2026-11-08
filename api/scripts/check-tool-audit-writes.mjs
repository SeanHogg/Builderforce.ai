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

/** file (relative to src, POSIX) -> why a direct insert is allowed there. */
const ALLOWED = new Map([
  ['application/audit/toolAuditWrite.ts', 'the writer itself'],
  // TEMPORARY: both build their rows with `runFailureEventRow`, which will redact (removed from this list when it does).
  ['application/runtime/staleExecutionReaper.ts', 'rows come from runFailureEventRow, which will redact'],
  ['application/runtime/recordRunFailureEvent.ts', 'rows come from runFailureEventRow, which will redact'],
]);

const INSERT = /\binsert\(\s*(?:schema\.)?toolAuditEvents\s*\)/g;

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
  for (const match of text.matchAll(INSERT)) {
    const line = text.slice(0, match.index).split('\n').length;
    violations.push(`${rel}:${line}`);
  }
}

if (violations.length > 0) {
  console.error('Tool-audit write guard: tool_audit_events is inserted outside insertToolAudit:\n');
  for (const v of violations) console.error(`   ${v}`);
  console.error('\nUse `insertToolAudit(db, row | rows)` (application/audit/toolAuditWrite.ts): it redacts args/result before the insert.');
  process.exit(1);
}
console.log('Tool-audit write guard OK - no tool_audit_events insert outside insertToolAudit.');
