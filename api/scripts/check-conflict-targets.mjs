#!/usr/bin/env node
/**
 * An upsert on a PARTIAL unique index must restate the index's predicate.
 *
 * Postgres matches `ON CONFLICT (cols)` to a unique index by its columns AND, for a
 * partial index, by its WHERE clause. A statement that names the columns but not the
 * predicate resolves to no index at all and raises, at runtime, on every execution:
 *
 *   there is no unique or exclusion constraint matching the ON CONFLICT specification
 *
 * Nothing catches that earlier. It type-checks, it passes every test that stubs the
 * database, and it fails only against a real Postgres — which is how a bare
 * `onConflictDoNothing({ target: [chatId, eventKey] })` reached production and broke
 * EVERY chat send, and how four `credentials` writers had broken connecting a ledger,
 * a payout account, a YouTube channel and an API-key integration before it.
 *
 * THE RULE. For every `onConflictDoNothing` / `onConflictDoUpdate` whose `target`
 * names columns of one table: if a PARTIAL unique index covers exactly those columns
 * and no FULL unique index / constraint / primary key does, the call must carry the
 * predicate (`where` on DoNothing, `targetWhere` on DoUpdate). Drizzle's names for it
 * differ per method; either spelling is accepted.
 *
 * WHERE THE INDEXES COME FROM. Both the Drizzle schema (`uniqueIndex().on().where()`)
 * and every migration track (`CREATE UNIQUE INDEX … WHERE`, replayed in order so a
 * later `DROP INDEX` retires an earlier definition). The migrations are the truth the
 * database was built from; the schema is read too because some indexes predate
 * tracked migrations. A schema that declares a partial index as `.unique()` is a lie
 * this guard would believe, so keep the declaration honest — that lie is exactly what
 * hid `chat_memories.agent_host_session_id`.
 *
 * Deliberately lexical, like the other schema guards: it runs before anything builds.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { collectSourceFiles } from './lib/drizzleSchema.mjs';
import { MIGRATION_TRACKS } from './lib/migrationTracks.mjs';
import { splitSqlStatements } from './lib/splitSqlStatements.mjs';

const api = resolve(import.meta.dirname, '..');
const srcDir = resolve(api, 'src');

const key = (table, cols) => `${table}(${[...cols].sort().join(',')})`;

/** Balanced `(`…`)` starting at `open`; returns the inner text and the index after it. */
function balanced(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return [text.slice(open + 1, i), i + 1];
  }
  return [text.slice(open + 1), text.length];
}

// ── Schema ──────────────────────────────────────────────────────────────────

/** varName → { table, cols: Map<prop, sqlName> } */
const tablesByVar = new Map();
const partial = new Set();
const full = new Set();
const sources = collectSourceFiles(srcDir).map((file) => ({ file, text: readFileSync(file, 'utf8') }));

for (const { text } of sources) {
  for (const m of text.matchAll(/export\s+const\s+([\w$]+)\s*=\s*pgTable\(\s*'([^']+)'/g)) {
    const [args] = balanced(text, m.index + m[0].indexOf('pgTable(') + 'pgTable'.length);
    const table = m[2];
    const cols = new Map();
    for (const c of args.matchAll(/^\s*([\w$]+)\s*:\s*[\w$]+\(\s*'([^']+)'/gm)) cols.set(c[1], c[2]);
    tablesByVar.set(m[1], { table, cols });

    // Column-level `.unique()` / `.primaryKey()` — a declaration line ends at the next
    // property, so a lookahead to the line's end is the whole chain.
    for (const c of args.matchAll(/^\s*([\w$]+)\s*:\s*[\w$]+\(\s*'([^']+)'[^\n]*?\.(unique|primaryKey)\(\)/gm)) {
      full.add(key(table, [c[2]]));
    }
    const colsOf = (list) => [...list.matchAll(/[\w$]+\.([\w$]+)/g)].map((r) => cols.get(r[1]) ?? r[1]);
    for (const idx of args.matchAll(/\b(uniqueIndex|unique)\(\s*(?:'[^']*')?\s*\)\s*\.on\(/g)) {
      const [on, after] = balanced(args, idx.index + idx[0].length - 1);
      const isPartial = /^\s*\.where\(/.test(args.slice(after));
      (isPartial ? partial : full).add(key(table, colsOf(on)));
    }
    for (const pk of args.matchAll(/\bprimaryKey\(\s*\{\s*columns\s*:\s*\[([^\]]*)\]/g)) full.add(key(table, colsOf(pk[1])));
  }
}

// ── Migrations ──────────────────────────────────────────────────────────────

const CREATE_UNIQUE = /^CREATE\s+UNIQUE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([\w$]+)"?\s+ON\s+(?:ONLY\s+)?(?:public\.)?"?([\w$]+)"?\s*(?:USING\s+\w+\s*)?\(([\s\S]*?)\)\s*(NULLS\s+NOT\s+DISTINCT\s*)?(?:WHERE\s+([\s\S]+))?$/i;
const DROP_INDEX = /^DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?"?([\w$]+)"?/i;
const UNIQUE_CONSTRAINT = /(?:ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([\w$]+)"?[\s\S]*?)?\b(?:UNIQUE|PRIMARY\s+KEY)\s*(?:NULLS\s+NOT\s+DISTINCT\s*)?\(([^)]*)\)/gi;
const CREATE_TABLE = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([\w$]+)"?/i;

for (const track of MIGRATION_TRACKS) {
  let files;
  try { files = readdirSync(resolve(api, track.dir)).filter((f) => f.endsWith('.sql')).sort(); } catch { continue; }
  /** index name → key, replayed in order so a DROP retires the definition. */
  const live = new Map();
  for (const f of files) {
    for (const raw of splitSqlStatements(readFileSync(resolve(api, track.dir, f), 'utf8'))) {
      const stmt = raw.replace(/--[^\n]*/g, '').trim();
      const created = stmt.match(CREATE_UNIQUE);
      if (created) {
        const cols = created[3].split(',').map((s) => s.trim().replace(/"/g, ''));
        live.set(created[1], { k: key(created[2], cols), partial: !!created[5] });
        continue;
      }
      const dropped = stmt.match(DROP_INDEX);
      if (dropped) { live.delete(dropped[1]); continue; }
      const table = stmt.match(CREATE_TABLE)?.[1];
      for (const u of stmt.matchAll(UNIQUE_CONSTRAINT)) {
        const owner = u[1] ?? table;
        if (owner) full.add(key(owner, u[2].split(',').map((s) => s.trim().replace(/"/g, ''))));
      }
    }
  }
  for (const { k, partial: p } of live.values()) (p ? partial : full).add(k);
}

// ── Upserts ─────────────────────────────────────────────────────────────────

const failures = [];
for (const { file, text } of sources) {
  if (file.endsWith('.test.ts')) continue;
  for (const m of text.matchAll(/\.onConflictDo(Nothing|Update)\(/g)) {
    const [call] = balanced(text, m.index + m[0].length - 1);
    const target = call.match(/\btarget\s*:\s*(\[[^\]]*\]|[\w$]+\.[\w$]+)/);
    if (!target) continue;
    const refs = [...target[1].matchAll(/([\w$]+)\.([\w$]+)/g)];
    const owner = refs.length ? tablesByVar.get(refs[0][1]) : null;
    if (!owner) continue;
    const k = key(owner.table, refs.map((r) => owner.cols.get(r[2]) ?? r[2]));
    if (!partial.has(k) || full.has(k)) continue;
    if (/\b(?:targetWhere|where)\s*:/.test(call)) continue;
    const line = text.slice(0, m.index).split('\n').length;
    failures.push(`${relative(api, file).replace(/\\/g, '/')}:${line} — ${k} is a PARTIAL unique index; add ${m[1] === 'Nothing' ? '`where`' : '`targetWhere`'} with its predicate`);
  }
}

if (failures.length) {
  console.error(`✗ check:conflict-targets — ${failures.length} upsert(s) omit a partial index's predicate, which Postgres rejects on every execution:\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`✓ check:conflict-targets — every upsert on a partial unique index restates its predicate (${partial.size} partial indexes known)`);
