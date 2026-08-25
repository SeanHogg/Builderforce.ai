/**
 * PRD 19 §9 — the deprecation parity meter.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `burnrateos.com` is being DEPRECATED, and deprecation is a parity obligation:
 * a source capability that is neither built nor explicitly retired is LOST at
 * shutdown. PRD 19 §9 publishes the register of what is still missing. A register
 * in a markdown table rots the moment someone closes a gap, so the register is
 * committed as TSV and this script is the thing that says whether it still matches
 * the source.
 *
 * ── HOW PARITY IS DECIDED, WITHOUT GUESSING ─────────────────────────────────
 * Mapping 106 route modules by name similarity would be a guess. BurnRateOS writes
 * RAW SQL, so every route module names the tables it touches in its own source, and
 * that is the evidence used here:
 *
 *   1. per BurnRateOS route module, extract `FROM|JOIN|INTO|UPDATE <table>`;
 *   2. resolve each table through `source-to-target.tsv` to its Builderforce target;
 *   3. `primitive`/`merged`/`session`/`flatten` were absorbed by a kernel primitive,
 *      which is feature-reached by construction — only a `keep` target can sit unreached;
 *   4. a `keep` target counts as REACHED unless it appears in
 *      `.table-adoption-baseline.txt`, the existing CI-maintained list of tables that
 *      ONLY the generic entity layer touches.
 *
 * Step 4 is the whole point of reusing the adoption baseline rather than inventing a
 * second definition of "migrated". "Opens in EntityBrowser" does not count as adoption
 * anywhere else in this repository and it must not count here either.
 *
 * ── THE SOURCE TREE IS OPTIONAL ─────────────────────────────────────────────
 * The BurnRateOS checkout is NOT part of this repository, so a developer without it
 * must not get a red build. Absent the source, this degrades to verifying the committed
 * registers against `source-to-target.tsv` and the adoption baseline — which is the half
 * that can actually drift as gaps are closed here. Full re-derivation needs the source
 * and is what `--update` does.
 *
 *   node scripts/check-burnrate-parity.mjs            # verify
 *   node scripts/check-burnrate-parity.mjs --update   # re-derive from source
 *
 * Point at a non-default checkout with BURNRATE_SOURCE_DIR.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const dataDir = join(repo, 'specs', 'builderforce', 'data-model');
const mapPath = join(dataDir, 'source-to-target.tsv');
const parityPath = join(dataDir, 'burnrate-parity.tsv');
const modulesPath = join(dataDir, 'burnrate-modules.tsv');
const baselinePath = join(here, '.table-adoption-baseline.txt');
const schemaDir = join(here, '..', 'src', 'infrastructure', 'database', 'schema');

const srcRoot = process.env.BURNRATE_SOURCE_DIR
  || 'c:/code/burnrateos.com/product/api/src/worker/routes';
const update = process.argv.includes('--update');

const fail = (msg, detail = []) => {
  console.error(`❌  check-burnrate-parity — ${msg}`);
  for (const d of detail.slice(0, 30)) console.error(`    ${d}`);
  if (detail.length > 30) console.error(`    … and ${detail.length - 30} more`);
  process.exit(1);
};

// ── the two inputs that live in THIS repo ───────────────────────────────────
if (!existsSync(mapPath)) fail(`coverage map missing: ${mapPath}`);
const target = new Map();
for (const line of readFileSync(mapPath, 'utf8').trim().split(/\r?\n/).slice(1)) {
  const [product, source, domain, move, to] = line.split('\t');
  if (source) target.set(source, { product, domain, move, to });
}

const registryOnly = new Set(
  readFileSync(baselinePath, 'utf8').split(/\r?\n/)
    .map((s) => s.trim()).filter((s) => s && !s.startsWith('#')));

// Every target the register names must still have a Drizzle declaration. A gap is a
// missing FEATURE PATH, never a missing table — if that stops being true, the register
// has quietly become a schema request and PRD 19 §9.3's headline claim is wrong.
let declared = new Set();
for (const f of readdirSync(schemaDir)) {
  if (!f.endsWith('.ts')) continue;
  const src = readFileSync(join(schemaDir, f), 'utf8');
  for (const m of src.matchAll(/pgTable\(\s*'([a-z0-9_]+)'/g)) declared.add(m[1]);
}

// ── policy v1 dispositions, mirrored from burnrateCutoverPolicy.json ────────
const RETIRE = {
  affiliate_referrals: 'affiliates → retire_export',
  referral_entries: 'affiliates → retire_export',
  ai_voice_agent_calls: 'phoneVoip → retire_port_out (SignalWire)',
  blog_posts: 'blogContent → transform_existing (knowledge_documents)',
};
const TRANSFORM = {
  billing_plans: 'pricing → transform_existing (PlanLimits/pricingConfiguration is canonical)',
  plan_features: 'pricing → transform_existing',
  business_pricing_models: 'pricing → transform_existing',
  pricing_simulations: 'pricing → transform_existing',
  system_features: 'pricing → transform_existing (feature gating is canonical in BF)',
  payment_methods: 'providers → stripe retain_reconcile',
};

// ── derive from the BurnRateOS source tree, when it is present ──────────────
function deriveFromSource() {
  const rows = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
      if (!e.name.endsWith('.ts')) continue;
      const src = readFileSync(p, 'utf8');
      const mod = relative(srcRoot, p).split(sep).join('/').replace(/\.ts$/, '');
      const endpoints = new Set(
        [...src.matchAll(/\.(get|post|put|patch|delete|all)\(\s*["'`]([^"'`]+)["'`]/g)]
          .map((m) => `${m[1].toUpperCase()} ${m[2]}`));
      const tables = [...new Set(
        [...src.matchAll(/(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]{2,})/gi)]
          .map((m) => m[1].toLowerCase()))].filter((t) => target.has(t));
      rows.push({ mod, endpoints: endpoints.size, tables });
    }
  };
  walk(srcRoot);

  const modules = [];
  const byTarget = new Map();
  for (const r of rows) {
    const gaps = [];
    let reached = 0;
    for (const t of r.tables) {
      const { move, to, domain } = target.get(t);
      if (move !== 'keep' || !registryOnly.has(to)) { reached += 1; continue; }
      gaps.push(to);
      if (!byTarget.has(to)) byTarget.set(to, { target: to, domain, sources: new Set(), modules: new Set(), endpoints: 0 });
      const g = byTarget.get(to);
      g.sources.add(t);
      if (!g.modules.has(r.mod)) { g.modules.add(r.mod); g.endpoints += r.endpoints; }
    }
    modules.push({
      mod: r.mod, endpoints: r.endpoints, tables: r.tables.length, reached,
      pct: r.tables.length ? Math.round((reached / r.tables.length) * 100) : null,
      gaps: [...new Set(gaps)],
    });
  }
  return { modules, register: [...byTarget.values()] };
}

// ── serialise ───────────────────────────────────────────────────────────────
const dispositionOf = (t) => (RETIRE[t] ? 'retire' : TRANSFORM[t] ? 'transform' : 'build');
const noteOf = (t) => RETIRE[t] || TRANSFORM[t] || '';
const ORDER = { build: 0, transform: 1, retire: 2 };

function renderParity(register) {
  const rows = [['disposition', 'target', 'domain', 'source_tables', 'br_modules', 'br_endpoints', 'note']];
  const sorted = [...register].sort((a, b) =>
    ORDER[dispositionOf(a.target)] - ORDER[dispositionOf(b.target)]
    || a.domain.localeCompare(b.domain) || a.target.localeCompare(b.target));
  for (const g of sorted) {
    rows.push([dispositionOf(g.target), g.target, g.domain,
      [...g.sources].sort().join(' '), [...g.modules].sort().join(' '),
      String(g.endpoints), noteOf(g.target)]);
  }
  return rows.map((r) => r.join('\t')).join('\n') + '\n';
}

function renderModules(modules) {
  const rows = [['br_module', 'endpoints', 'tables_touched', 'tables_reached', 'parity_pct', 'gap_targets']];
  const sorted = [...modules].sort((a, b) =>
    (a.pct ?? 999) - (b.pct ?? 999) || b.tables - a.tables || a.mod.localeCompare(b.mod));
  for (const m of sorted) {
    rows.push([m.mod, String(m.endpoints), String(m.tables), String(m.reached),
      m.pct === null ? 'n/a' : String(m.pct), m.gaps.sort().join(' ')]);
  }
  return rows.map((r) => r.join('\t')).join('\n') + '\n';
}

// ── run ─────────────────────────────────────────────────────────────────────
const haveSource = existsSync(srcRoot);

if (update) {
  if (!haveSource) fail(`--update needs the BurnRateOS checkout; not found at ${srcRoot}`, [
    'Set BURNRATE_SOURCE_DIR to the routes directory of a BurnRateOS checkout.']);
  const { modules, register } = deriveFromSource();
  writeFileSync(parityPath, renderParity(register));
  writeFileSync(modulesPath, renderModules(modules));
  const counts = register.reduce((a, g) => { a[dispositionOf(g.target)] += 1; return a; }, { build: 0, transform: 0, retire: 0 });
  console.log(`✍️   check-burnrate-parity: registers rewritten — ${register.length} target(s) · build ${counts.build} · transform ${counts.transform} · retire ${counts.retire}.`);
  process.exit(0);
}

if (!existsSync(parityPath) || !existsSync(modulesPath)) {
  fail('committed registers missing', [
    `expected ${relative(repo, parityPath)} and ${relative(repo, modulesPath)}`,
    'Regenerate with --update against a BurnRateOS checkout. PRD 19 §9 depends on them.']);
}

const parityRows = readFileSync(parityPath, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split('\t'));
const problems = [];
const counts = { build: 0, transform: 0, retire: 0 };
let closed = 0;

for (const [disposition, tgt, domain, sources] of parityRows) {
  counts[disposition] = (counts[disposition] ?? 0) + 1;

  // (a) the register may not drift from policy v1.
  const expected = dispositionOf(tgt);
  if (expected !== disposition) problems.push(`${tgt}: register says '${disposition}', policy v1 says '${expected}'`);

  // (b) a gap is a missing feature path, never a missing table.
  if (!declared.has(tgt)) problems.push(`${tgt}: named in the register but has no pgTable declaration — a gap must never be a schema request`);

  // (c) every source table must still resolve, and to this target.
  for (const s of (sources || '').split(' ').filter(Boolean)) {
    const t = target.get(s);
    if (!t) problems.push(`${tgt}: source table '${s}' is no longer in source-to-target.tsv`);
    else if (t.to !== tgt) problems.push(`${tgt}: source '${s}' now maps to '${t.to}'`);
    else if (t.domain !== domain) problems.push(`${tgt}: source '${s}' is domain '${t.domain}', register says '${domain}'`);
  }

  // (d) THE METER. A `build` row whose target has left the adoption baseline is a gap
  //     that has been CLOSED — good news, but the register is now stale and PRD 19 §9
  //     is overstating what is left.
  if (disposition === 'build' && !registryOnly.has(tgt)) { closed += 1; problems.push(`${tgt}: now reached by a feature path — gap CLOSED, rerun with --update`); }
}

// (e) the count must never rise silently.
if (haveSource) {
  const { register } = deriveFromSource();
  const committed = new Set(parityRows.map((r) => r[1]));
  const fresh = register.map((g) => g.target).filter((t) => !committed.has(t));
  for (const t of fresh) problems.push(`${t}: NEW gap not in the committed register — a BurnRateOS module depends on it and nothing reaches it`);
}

if (problems.length) {
  const onlyClosed = closed > 0 && problems.length === closed;
  fail(onlyClosed
    ? `${closed} gap(s) closed since the register was written — rerun with --update`
    : `${problems.length} problem(s) between the committed register and source`, problems);
}

const src = haveSource ? 'source re-derived' : 'registers only (no BurnRateOS checkout)';
console.log(
  `✅  check-burnrate-parity OK — ${parityRows.length} target(s): build ${counts.build} · transform ${counts.transform} · retire ${counts.retire} (${src}).\n` +
  `      PRD 19 §9 deprecation meter. Every target has a Drizzle declaration, so no gap is a schema request.`);
