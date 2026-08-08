#!/usr/bin/env node
/**
 * One-shot: collapse the 16 ad-hoc schema modules onto the 15 domains + kernel
 * (PRD 20 §5 step 2).
 *
 * The 16 modules that exist are already most of the domain map, so this is a
 * rename plus five merges, not a greenfield:
 *
 *   common                     → kernel
 *   brain + collaboration      → canvas
 *   work + pmo + delivery      → delivery
 *   runtime + llm              → agents
 *   billing                    → finance
 *   drive + mailbox            → integrations
 *
 * Every merge deletes cross-module edges outright — `brain ↔ collaboration`,
 * `work ↔ runtime`, `work ↔ pmo` were three of the cycles
 * `check-domain-boundary.mjs` baselined at 82. An import between two files that
 * become one file is not a boundary being crossed; it is a boundary that stopped
 * existing.
 *
 * Kept as a script rather than done by hand because the import rewriting has to
 * be exhaustive: every `from './work'` across the api becomes `from './delivery'`
 * or the build breaks in ~390 places, and a hand pass over that is how one gets
 * missed.
 *
 * Idempotent — re-running after the merge is a no-op, because the sources are
 * gone.
 */
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url), '..');
const apiSrc = resolve(here, '..', 'src');
const schemaDir = resolve(apiSrc, 'infrastructure', 'database', 'schema');

/** target ← [sources], in the order their bodies should be concatenated. */
const MERGES = [
  ['kernel', ['common']],
  ['canvas', ['brain', 'collaboration']],
  ['delivery', ['work', 'pmo', 'delivery']],
  ['agents', ['runtime', 'llm']],
  ['finance', ['billing']],
  ['integrations', ['drive', 'mailbox']],
];

/** Header prepended to a merged module that did not exist before. */
const HEADERS = {
  canvas:
    'Schema — Canvas & ideas, owned by the **Brain** (PRD 20 §3).\n *\n' +
    ' * Root entity `creation_session`. 57 source tables in → 8 out, 46 of them absorbed\n' +
    ' * by the kernel — which is the proof, not a gap: the canvas IS `artifact` +\n' +
    ' * `thread` + `message` + `share_link`, so a domain whose tables nearly all became\n' +
    ' * kernel primitives was generalised correctly (§3).\n *\n' +
    ' * Merged from `brain.ts` and `collaboration.ts`, which imported each other in\n' +
    ' * both directions. §2.1\'s session test is why they were always one domain: if a\n' +
    ' * thing is authored content, that people can be present in, and can be shared, it\n' +
    ' * is not a feature — it is the canvas. Authoring lived in one file and presence in\n' +
    ' * the other, and every feature that needed both had to import across the seam.',
  delivery:
    'Schema — Delivery & work, owned by the **Manager** (PRD 20 §3).\n *\n' +
    ' * Root entity `work_item`. 123 source tables in → 54 out. Builderforce contributed\n' +
    ' * 37 of the survivors — it owns this domain.\n *\n' +
    ' * Merged from `work.ts`, `pmo.ts` and `delivery.ts`. Portfolios, initiatives,\n' +
    ' * objectives, key results, epics, tasks and milestones were split across three\n' +
    ' * files and 25 tables; they are one tree with a `kind`, which is what kernel\n' +
    ' * `work_items` now holds. `portfolios` = `initiatives` was one of the eight\n' +
    ' * duplicate-shape clusters this repo carried before any merge (§5 step 0).',
  agents:
    'Schema — Agents & runtime, owned by **the platform** (PRD 20 §3).\n *\n' +
    ' * Root entity `agent`. 75 source tables in → 40 out.\n *\n' +
    ' * Merged from `runtime.ts` and `llm.ts`. A model, a provider, a routing decision\n' +
    ' * and the execution that used them are one bounded context — the split ran through\n' +
    ' * the middle of every question worth asking ("why did this run cost that much"),\n' +
    ' * and `work ↔ runtime` was one of the import cycles the boundary guard baselined.',
  finance:
    'Schema — Finance, owned by the **CFO** (PRD 20 §3).\n *\n' +
    ' * Root entity `ledger_entry`. 70 source tables in → 26 out, 31 of them absorbed by\n' +
    ' * the kernel ledger: points, tokens, AI credits, enrichment credits, campaign\n' +
    ' * dollars, phone balance, partner and seller balances, payouts and commissions are\n' +
    ' * one table with a denomination column.\n *\n' +
    ' * Renamed from `billing.ts`: billing is one capability of the finance domain, not\n' +
    ' * the domain, and naming the module after the smaller of the two is what left\n' +
    ' * expenses, runway and scenarios with nowhere obvious to go.',
  integrations:
    'Schema — Integrations, owned by **the platform** (PRD 20 §3).\n *\n' +
    ' * Root entity `connection`. 41 source tables in → 1 out, 33 absorbed by the kernel.\n' +
    ' * Like the canvas, that is the proof rather than a gap: integrations ARE\n' +
    ' * `connection` + `credential` + `delivery` + `sync_state`, and migration 0410\n' +
    ' * already established that a vendor is a manifest row, not DDL.\n *\n' +
    ' * Merged from `drive.ts` and `mailbox.ts`. Both wrote the same paragraph about\n' +
    ' * sealed tokens and a mirrored `expiresAt` — twice, three months apart — which is\n' +
    ' * the duplication `drive_connections = mailbox_connections` names in the\n' +
    ' * signature-duplication baseline.',
};

const read = (name) => readFileSync(resolve(schemaDir, `${name}.ts`), 'utf8');
const exists = (name) => existsSync(resolve(schemaDir, `${name}.ts`));

/** Split a module into its import block and its body. */
function split(text) {
  const lines = text.split('\n');
  const imports = [];
  const body = [];
  let i = 0;
  let inImport = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^import\s/.test(line)) inImport = true;
    if (inImport) {
      imports.push(line);
      if (/from\s+'[^']+';\s*$/.test(line) || /^import\s+'[^']+';\s*$/.test(line)) inImport = false;
      continue;
    }
    body.push(line);
  }
  return { imports: imports.join('\n'), body: body.join('\n') };
}

/** Merge N import blocks into one, dropping anything that now resolves locally. */
function mergeImports(blocks, absorbed) {
  const pgCore = new Set();
  const drizzleOrm = new Set();
  const siblings = new Map();
  const other = new Set();

  for (const block of blocks) {
    const re = /import\s+(type\s+)?\{([\s\S]*?)\}\s+from\s+'([^']+)';/g;
    for (const m of block.matchAll(re)) {
      const names = m[2].split(',').map((s) => s.trim()).filter(Boolean);
      const from = m[3];
      if (from === 'drizzle-orm/pg-core') names.forEach((n) => pgCore.add(n));
      else if (from === 'drizzle-orm') names.forEach((n) => drizzleOrm.add(n));
      else if (from.startsWith('./')) {
        const mod = from.slice(2).replace(/\.js$/, '');
        if (absorbed.has(mod)) continue; // now in this same file
        if (!siblings.has(mod)) siblings.set(mod, new Set());
        names.forEach((n) => siblings.get(mod).add(n));
      } else other.add(m[0]);
    }
    for (const m of block.matchAll(/^import\s+'[^']+';$/gm)) other.add(m[0]);
  }

  const out = [];
  const wrap = (names, from) => {
    const list = [...names].sort();
    const oneLine = `import { ${list.join(', ')} } from '${from}';`;
    return oneLine.length <= 100 ? oneLine : `import {\n  ${list.join(',\n  ')},\n} from '${from}';`;
  };
  if (pgCore.size) out.push(wrap(pgCore, 'drizzle-orm/pg-core'));
  if (drizzleOrm.size) out.push(wrap(drizzleOrm, 'drizzle-orm'));
  for (const [mod, names] of [...siblings].sort()) out.push(wrap(names, `./${mod}`));
  out.push(...other);
  return out.join('\n');
}

/** Every .ts under `src` — the import rewrite has to be exhaustive. */
function allSources(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) allSources(full, out);
    else if (e.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// ── Merge ───────────────────────────────────────────────────────────────────

const renamedModules = new Map(); // old module name → new module name
let merged = 0;

for (const [target, sources] of MERGES) {
  const present = sources.filter(exists);
  if (present.length === 0) continue; // already merged

  const absorbed = new Set(present.filter((s) => s !== target));
  const targetExisted = exists(target) && present.includes(target);

  const parts = present.map((s) => ({ name: s, ...split(read(s)) }));
  const imports = mergeImports(parts.map((p) => p.imports), new Set([...absorbed, target]));

  const header = HEADERS[target]
    ? `/**\n * ${HEADERS[target]}\n *\n * Merged from ${present.map((p) => `\`${p}.ts\``).join(' + ')} by\n * scripts/merge-schema-modules.mjs (PRD 20 §5 step 2).\n */\n\n`
    : '';

  const bodies = parts
    .map((p) => (present.length > 1 ? `\n// ═══ from ${p.name}.ts ═══\n${p.body}` : p.body))
    .join('\n');

  const targetPath = resolve(schemaDir, `${target}.ts`);
  if (target === 'kernel' && existsSync(targetPath)) {
    // kernel.ts is authored, not generated — append the absorbed body, keep the head.
    const kernel = read('kernel');
    const extra = parts.filter((p) => p.name !== 'kernel');
    const kernelImports = mergeImports([split(kernel).imports, ...extra.map((p) => p.imports)], new Set([...absorbed, 'kernel']));
    const kernelBody = split(kernel).body;
    const kernelHead = kernel.slice(0, kernel.indexOf('\nimport '));
    writeFileSync(
      targetPath,
      `${kernelHead}\n\n${kernelImports}\n${kernelBody}\n` +
        extra.map((p) => `\n// ═══ from ${p.name}.ts — shared enums and column types ═══\n${p.body}`).join('\n'),
    );
  } else {
    writeFileSync(targetPath, `${targetExisted ? '' : header}${imports}\n${bodies}\n`);
  }

  for (const s of absorbed) {
    rmSync(resolve(schemaDir, `${s}.ts`));
    renamedModules.set(s, target);
  }
  merged++;
  console.log(`   ${present.join(' + ')} → ${target}.ts`);
}

if (merged === 0) {
  console.log('ℹ️   Schema modules already merged. Nothing to do.');
  process.exit(0);
}

// ── Rewrite every import of a module that moved ─────────────────────────────

let rewritten = 0;
for (const file of allSources(apiSrc)) {
  const text = readFileSync(file, 'utf8');
  let next = text;
  for (const [from, to] of renamedModules) {
    next = next
      .replace(new RegExp(`(from\\s+')(\\.{1,2}(?:/[\\w.-]+)*?)/schema/${from}(\\.js)?'`, 'g'), `$1$2/schema/${to}'`)
      .replace(new RegExp(`(from\\s+')\\./${from}(\\.js)?'`, 'g'), `$1./${to}'`);
  }
  if (next !== text) {
    writeFileSync(file, next);
    rewritten++;
  }
}

// ── Rewrite the barrel to the 16 target modules, kernel first ───────────────

const FINAL = [
  'kernel', 'identity', 'finance', 'delivery', 'agents', 'canvas', 'commerce',
  'governance', 'platform', 'integrations', 'growth', 'hiring', 'people',
  'investor', 'revenue', 'support',
];
const barrel = resolve(apiSrc, 'infrastructure', 'database', 'schema.ts');
const head = readFileSync(barrel, 'utf8').split('\nexport * from')[0];
writeFileSync(
  barrel,
  `${head}\n${FINAL.filter((m) => exists(m)).map((m) => `export * from './schema/${m}';`).join('\n')}\n`,
);

console.log(`✅  ${merged} merge(s); ${rewritten} file(s) rewritten; barrel now lists ${FINAL.filter(exists).length} modules.`);
