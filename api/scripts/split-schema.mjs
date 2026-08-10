#!/usr/bin/env node
/**
 * ONE-SHOT: split `infrastructure/database/schema.ts` into per-context modules
 * under `infrastructure/database/schema/`, leaving `schema.ts` as a barrel.
 *
 * Kept in the repo as the record of how the split was produced (and so it can be
 * re-run if the boundaries are ever re-cut). It is NOT wired into any npm script.
 *
 * Mechanics:
 *   - Chunk the file at top-level statements, keeping each statement's leading
 *     comment block attached to it (the comments carry the migration history and
 *     the reasoning — losing them would be the real cost of a split).
 *   - Assign each chunk to a context by its table name, via CONTEXTS below.
 *   - Emit one file per context, importing the drizzle primitives it uses and
 *     the sibling exports it references.
 *   - Rewrite schema.ts as `export * from './schema/<context>'` in the original
 *     order, so all ~390 importers and drizzle.config.ts are untouched.
 *
 * Circular imports between context files are expected and safe: every table→table
 * reference in this schema lives inside a lazy callback (`references(() => t.id)`,
 * and the index/primaryKey builder), so nothing is dereferenced at module-eval
 * time. `schema.tables.test.ts` renders SQL for every exported table to prove it.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcFile = resolve(here, '../src/infrastructure/database/schema.ts');
const outDir = resolve(here, '../src/infrastructure/database/schema');

/**
 * Bounded contexts, in the order the barrel re-exports them. Each entry is a list
 * of substrings matched (case-insensitively) against the table's SQL name; first
 * match wins, so more specific contexts come first. Anything unmatched lands in
 * `misc` — which is reported so the boundaries can be tightened deliberately
 * rather than by accident.
 */
const CONTEXTS = [
  ['identity', ['user', 'auth_', 'session', 'oauth', 'magic_link', 'tenant', 'segment', 'member', 'invit', 'legal', 'impersonat', 'permission', 'platform_module', 'api_key', 'terms', 'device_authorization', 'vscode_connection']],
  ['billing', ['billing', 'subscription', 'payment', 'invoice', 'plan_', 'consumption', 'meter', 'spend', 'finops', 'cost', 'budget', 'credit', 'rd_financials', 'rd_revenue']],
  ['work', ['task', 'project', 'epic', 'sprint', 'kanban', 'board', 'swimlane', 'lane', 'backlog', 'workitem', 'work_item', 'work_delta', 'roadmap', 'prd', 'spec_', 'specs', 'story', 'estimate',
            'ticket_role_signoff', 'ticket_participant', 'external_ticket_link', 'delay_reason']],
  ['pmo', ['portfolio', 'initiative', 'objective', 'key_result', 'okr', 'goal', 'allocation', 'planning', 'milestone', 'dependency', 'value_stream', 'program', 'pmo_', 'headcount', 'open_position']],
  ['runtime', ['execution', 'agent', 'run_', 'runs', 'dispatch', 'tool_audit', 'otel', 'span', 'skill', 'artifact', 'capabilit', 'host', 'relay', 'container', 'workflow', 'trigger', 'cron', 'job_',
               'manager_', 'usage_snapshot', 'resource_lease', 'coordination_note']],
  ['llm', ['llm', 'model', 'prompt', 'trace', 'vendor', 'provider', 'token', 'inference', 'finetune', 'dataset', 'training', 'eval', 'embedding', 'persona', 'psychometric', 'limbic', 'evermind', 'ssm', 'trait_']],
  ['brain', ['brain', 'chat', 'message', 'memor', 'fact', 'knowledge', 'doc', 'recall', 'conversation']],
  ['delivery', ['repo', 'git', 'pull_request', 'pr_', 'commit', 'branch', 'ci_', 'build', 'deploy', 'release', 'quality', 'error_', 'incident', 'monitor', 'alert', 'qa_', 'test_', 'check',
                'changelog', 'mvp_', 'validation_', 'vulnerability', 'on_call', 'escalation_']],
  ['collaboration', ['ceremony', 'meeting', 'calendar', 'team', 'contributor', 'activity', 'timecard', 'time_', 'engagement', 'poker', 'retro', 'survey', 'feedback', 'notification', 'email',
                     'newsletter', 'pulse_', 'coaching_', 'rehearsal']],
  ['commerce', ['marketplace', 'freelanc', 'gig', 'job', 'proposal', 'talent', 'hire', 'listing', 'purchase', 'review', 'rating', 'rfp', 'deck', 'lead', 'marketing', 'demo', 'guest', 'visitor',
                'deliverable', 'support_ticket', 'business_contact', 'catalog_']],
  ['governance', ['governance', 'policy', 'compliance', 'audit', 'soc', 'security', 'approval', 'risk', 'control', 'tracker', 'diagnostic', 'insight', 'metric', 'analytic', 'dashboard', 'report', 'widget', 'benchmark', 'forecast',
                  'privacy_', 'pii_', 'data_subject', 'data_suppression', 'feature_', 'business_value', 'ai_tool_adoption', 'saved_quer', 'lens_']],
  ['platform', ['ide', 'site', 'file', 'workspace', 'storage', 'r2_', 'migration', 'integration', 'connector', 'webhook', 'seam', 'embed', 'studio', 'voice', 'video', 'media', 'canvas', 'office', 'export', 'ingestion',
                'import_', 'outbound_']],
];

const text = readFileSync(srcFile, 'utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const lines = text.split(/\r?\n/);

const STMT = /^(export\s+(?:const|type|interface|function|enum)|const|function|type|interface)\b/;

/** Indices of every top-level statement start. */
const starts = [];
lines.forEach((l, i) => { if (STMT.test(l)) starts.push(i); });

/** Walk back over the comment block / blank lines that belong to a statement. */
function commentStart(idx, floor) {
  let i = idx - 1;
  while (i > floor && (/^\s*(\/\/|\/\*|\*|\*\/)/.test(lines[i]) || lines[i].trim() === '')) i--;
  return i + 1;
}

const headerEnd = starts[0];
const header = lines.slice(0, commentStart(headerEnd, -1)).join(eol);

/** [{ name, sqlName, kind, text }] in file order. */
const chunks = [];
for (let s = 0; s < starts.length; s++) {
  const stmtLine = starts[s];
  const from = s === 0 ? headerEnd : commentStart(stmtLine, starts[s - 1]);
  const to = s + 1 < starts.length ? commentStart(starts[s + 1], stmtLine) : lines.length;
  const body = lines.slice(from, to).join(eol);
  const decl = lines[stmtLine];
  const name = decl.match(/^(?:export\s+)?(?:const|type|interface|function|enum)\s+(\w+)/)?.[1] ?? null;
  const sqlName = body.match(/pgTable\(\s*'([^']+)'/)?.[1] ?? null;
  const isTable = !!sqlName;
  chunks.push({ name, sqlName, isTable, text: body, index: s });
}

function contextFor(chunk) {
  if (!chunk.isTable) return null;
  const n = chunk.sqlName.toLowerCase();
  for (const [ctx, needles] of CONTEXTS) if (needles.some((x) => n.includes(x))) return ctx;
  return 'misc';
}

// Non-table chunks (enums, helper types, custom column types) are shared by many
// contexts, so they all live in `common` — which every context may import from.
const assignment = new Map(); // chunk.index -> context
for (const c of chunks) assignment.set(c.index, contextFor(c) ?? 'common');

const order = ['common', ...CONTEXTS.map(([c]) => c), 'misc'];
const byContext = new Map(order.map((c) => [c, []]));
for (const c of chunks) byContext.get(assignment.get(c.index)).push(c);

/** Every top-level identifier and the context that now owns it. */
const owner = new Map();
for (const c of chunks) if (c.name) owner.set(c.name, assignment.get(c.index));

/**
 * Helpers that were module-private in the single file (e.g. the `tsvector`
 * custom column type) but are used from more than one context now have to cross
 * a module boundary — so they need an `export`. Only promote the ones actually
 * referenced elsewhere; leaving the rest private keeps the split honest about
 * what is shared.
 */
for (const c of chunks) {
  if (!c.name || /^\s*export\b/m.test(c.text.split(eol).find((l) => STMT.test(l)) ?? '')) continue;
  const home = assignment.get(c.index);
  const usedElsewhere = chunks.some(
    (o) => o.index !== c.index &&
      assignment.get(o.index) !== home &&
      new RegExp(`\\b${c.name}\\b`).test(o.text),
  );
  if (usedElsewhere) {
    c.text = c.text.replace(
      new RegExp(`^((?:const|function|type|interface|enum)\\s+${c.name}\\b)`, 'm'),
      'export $1',
    );
  }
}

/** Drizzle primitives available from the original header import. */
const headerImports = new Set(
  (header.match(/^\s{2}(\w+),?$/gm) ?? []).map((l) => l.trim().replace(/,$/, '')).filter(Boolean),
);
headerImports.add('sql');
headerImports.add('AnyPgColumn');

const IDENT = /\b([A-Za-z_$][\w$]*)\b/g;

function renderContext(ctx, list) {
  const body = list.map((c) => c.text).join(eol + eol);

  const used = new Set();
  let m;
  IDENT.lastIndex = 0;
  while ((m = IDENT.exec(body)) !== null) used.add(m[1]);

  const localNames = new Set(list.map((c) => c.name).filter(Boolean));

  // drizzle primitives this file actually touches
  const pgCore = [...headerImports].filter((n) => n !== 'sql' && used.has(n)).sort();
  const needsSql = /\bsql`/.test(body) || /\bsql\./.test(body);

  // sibling exports referenced but not defined here
  const foreign = new Map(); // context -> names[]
  for (const n of used) {
    if (localNames.has(n)) continue;
    const o = owner.get(n);
    if (!o || o === ctx) continue;
    if (!foreign.has(o)) foreign.set(o, new Set());
    foreign.get(o).add(n);
  }

  const importLines = [];
  if (pgCore.length) {
    const typeOnly = pgCore.filter((n) => n === 'AnyPgColumn');
    const value = pgCore.filter((n) => n !== 'AnyPgColumn');
    if (value.length) importLines.push(`import {${eol}${value.map((n) => `  ${n},`).join(eol)}${eol}} from 'drizzle-orm/pg-core';`);
    if (typeOnly.length) importLines.push(`import type { ${typeOnly.join(', ')} } from 'drizzle-orm/pg-core';`);
  }
  if (needsSql) importLines.push(`import { sql } from 'drizzle-orm';`);
  for (const [o, names] of [...foreign].sort(([a], [b]) => a.localeCompare(b))) {
    importLines.push(`import { ${[...names].sort().join(', ')} } from './${o}';`);
  }

  const doc =
    `/**${eol}` +
    ` * Schema — ${ctx} context.${eol}` +
    ` *${eol}` +
    ` * Split out of the single 7,500-line \`schema.ts\`, which held all 322 tables${eol}` +
    ` * in one file and was the largest source file in the repo by a factor of three.${eol}` +
    ` * \`schema.ts\` is now a barrel that re-exports every context, so nothing that${eol}` +
    ` * imports from it had to change.${eol}` +
    ` *${eol}` +
    ` * Imports between context modules are circular by nature — a task references a${eol}` +
    ` * project, a project references a tenant, and ownership runs in both directions${eol}` +
    ` * across contexts. That is safe here because EVERY table→table reference sits${eol}` +
    ` * inside a lazy callback (\`references(() => other.id)\`, and the index /${eol}` +
    ` * primaryKey builders), so no cross-module value is dereferenced while the${eol}` +
    ` * modules are still evaluating. \`schema.tables.test.ts\` renders SQL for every${eol}` +
    ` * exported table to keep that guarantee honest.${eol}` +
    ` */${eol}`;

  return doc + (importLines.length ? importLines.join(eol) + eol + eol : eol) + body + eol;
}

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const written = [];
for (const ctx of order) {
  const list = byContext.get(ctx);
  if (!list.length) continue;
  writeFileSync(resolve(outDir, `${ctx}.ts`), renderContext(ctx, list), 'utf8');
  written.push([ctx, list.length, list.filter((c) => c.isTable).length]);
}

const barrel =
  `/**${eol}` +
  ` * Drizzle schema — the barrel.${eol}` +
  ` *${eol}` +
  ` * The definitions live in \`./schema/<context>.ts\`, one file per bounded${eol}` +
  ` * context. This file re-exports all of them so the ~390 modules that${eol}` +
  ` * \`import { … } from '…/database/schema'\` — and \`drizzle.config.ts\` — keep${eol}` +
  ` * working unchanged.${eol}` +
  ` *${eol}` +
  ` * Add a NEW table to the context file it belongs to, not here.${eol}` +
  ` */${eol}${eol}` +
  written.map(([ctx]) => `export * from './schema/${ctx}';`).join(eol) + eol;

writeFileSync(srcFile, barrel, 'utf8');

console.log('Split complete:');
for (const [ctx, total, tables] of written) console.log(`  ${ctx.padEnd(14)} ${String(tables).padStart(3)} tables, ${total} statements`);
const misc = byContext.get('misc');
if (misc.length) {
  console.log(`\n  ⚠  ${misc.length} unclassified table(s) landed in misc.ts:`);
  for (const c of misc) console.log(`       ${c.sqlName}`);
}
