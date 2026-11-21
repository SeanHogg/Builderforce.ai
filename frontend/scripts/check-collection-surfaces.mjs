#!/usr/bin/env node
/**
 * Collection-surfaces ratchet — PRD 47 §7 (docs/specs/platform.md).
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 * Every surface that browses a collection of records renders through the ONE
 * shared `<Collection>` (components/collection/Collection.tsx), or its local
 * adapter `components/pm/LocalCollection.tsx`. Card | List, sort, paging, the
 * pinned header/footer, selection and the bulk bar are the Collection's job, so
 * a page that hand-rolls any of them is a second copy of it.
 *
 * Outside `components/collection/`, a `.tsx` under `src/` fails on:
 *   table              a `<table` element
 *   data-table-styles  an import/use of `dataTableStyles`
 *   data-table-class   `data-table` in a className
 *   view-toggle        `<ViewToggle` WITHOUT an `options=` prop (the card/table
 *                      flag pair is the Collection's; `options` mode-pickers are fine)
 *   pagination         `<Pagination` or an import of `components/Pagination`
 * Tests (`*.test.tsx` / `*.spec.tsx`) are ignored, as are comments.
 *
 * ── SHRINK-ONLY ALLOWLIST ────────────────────────────────────────────────────
 * The surfaces that predate the rule are listed per file, per rule, with a count,
 * in `collection-surfaces.allowlist.json`. Each migration wave removes rows; the
 * list must be EMPTY after W6 (PRD 47 §9 done-check 1). So:
 *   - a file/rule above its allowlisted count (absent = 0) fails, naming file:line;
 *   - a file/rule BELOW its allowlisted count also fails, telling the author to run
 *     `--update` — a slack entry is room for the next regression;
 *   - `--update` only removes or lowers entries. It refuses to add a file or raise a
 *     count (nothing is written, exit 1). The single exception is the first seed,
 *     when the allowlist file does not exist yet.
 *
 * The PERMANENT exclusions (PRD 47 §2 "Out of scope") are NOT in that file — they
 * are below, each with its reason, because they never shrink.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────
 *   node scripts/check-collection-surfaces.mjs            # the check (fast edit set)
 *   node scripts/check-collection-surfaces.mjs --update   # record a shrink (lower-only)
 *   --src <dir> / --allowlist <file>                      # point at a fixture tree
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));

const argv = process.argv.slice(2);
const UPDATE = argv.includes('--update');
const flag = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? null : argv[at + 1] ?? null;
};
const srcDir = resolve(flag('--src') ?? resolve(here, '../src'));
const allowlistPath = resolve(flag('--allowlist') ?? resolve(here, 'collection-surfaces.allowlist.json'));
const UPDATE_HINT = 'node scripts/check-collection-surfaces.mjs --update';

// ═══════════════════════════════════════════════════════════════════════════════
// PERMANENT EXCLUSIONS — PRD 47 §2 "Out of scope (named, with reason)".
// These are not debt and never shrink. `rules` narrows an exclusion to the rules
// it is about; absent = every rule. A pattern ending in `/**` covers a directory.
// Every pattern must still match a file: an exclusion for a deleted surface is
// stale and fails the check, so this list cannot rot into a blanket waiver.
// ═══════════════════════════════════════════════════════════════════════════════
export const PERMANENT_EXCLUSIONS = [
  {
    path: 'components/ceremony/CeremonyHistoryPanel.tsx',
    rules: ['view-toggle'],
    reason: 'ViewToggle picks a ceremony kind (a filter), not a layout — an `options` mode-picker.',
  },
  {
    path: 'components/ceremony/CeremonyStage.tsx',
    rules: ['view-toggle'],
    reason: 'ViewToggle picks a stage mode, not a layout — an `options` mode-picker.',
  },
  {
    path: 'components/pm/PmVisualizersContent.tsx',
    rules: ['view-toggle'],
    reason: 'ViewToggles pick a section / tree-vs-timeline mode, not a layout — `options` mode-pickers.',
  },
  {
    path: 'components/task/TaskPrdTab.tsx',
    rules: ['view-toggle'],
    reason: 'ViewToggle picks preview vs raw, not a layout — an `options` mode-picker.',
  },
  {
    path: 'components/insights/**',
    reason: 'Lens/widget tables are chart companions inside a widget, sized by the widget — not a collection.',
  },
  {
    path: 'components/admin/panels/PermissionsPanel.tsx',
    reason: 'The role × permission matrix is an editable matrix, not rows of records.',
  },
  {
    path: 'app/import/BulkDryRunReport.tsx',
    reason: 'Import wizard dry-run report: local, transient wizard state, not a persisted collection.',
  },
  {
    path: 'app/import/BulkMappingTable.tsx',
    reason: 'Import wizard column mapping: local, transient wizard state, not a persisted collection.',
  },
  {
    // Also covers the canvas's prose renderers: SpecObjectBody renders spec/markdown
    // tables and DocumentEditor inserts a `<table>` into the user's rich-text document.
    // No markdown/prose renderer outside the canvas emits a `<table>` (checked 2026-11-20).
    path: 'components/creation-canvas/**',
    reason: 'Canvas internals: canvas object selection is a different model; its tables are document/widget content.',
  },
  {
    path: 'domains/canvas/**',
    reason: 'Canvas internals: canvas object selection is a different model.',
  },
  // ── Documents and comparison matrices (triaged 2026-11-20) ──────────────────
  // A fixed-shape grid whose rows are features/plans/lines of ONE document, read
  // across columns, is not a browsable set of records: Card mode would destroy the
  // comparison it exists to make, and it has nothing to page or sort.
  {
    path: 'app/pricing/PricingPageClient.tsx',
    rules: ['table'],
    reason: 'Plan × feature comparison matrix on the marketing pricing page.',
  },
  {
    path: 'app/features/page.tsx',
    rules: ['table'],
    reason: 'Feature comparison matrix on a marketing page.',
  },
  {
    path: 'app/product/page.tsx',
    rules: ['table'],
    reason: 'Integration × capability matrix on a marketing page.',
  },
  {
    path: 'components/marketing/CompetitorMatrix.tsx',
    rules: ['table', 'data-table-class'],
    reason: 'Competitor × capability comparison matrix (marketing).',
  },
  {
    path: 'components/marketplace/landing/landingSections.tsx',
    rules: ['table'],
    reason: 'Comparison table inside the marketplace landing copy.',
  },
  {
    path: 'app/legal/subprocessors/page.tsx',
    rules: ['table'],
    reason: 'Legal disclosure document: a fixed, published list that must read as the document.',
  },
  {
    path: 'components/invoice/PublicInvoice.tsx',
    rules: ['table'],
    reason: 'Invoice line items are part of ONE document (an invoice), not a browsable collection.',
  },
  {
    path: 'components/prompts/PromptVersionDiff.tsx',
    rules: ['table'],
    reason: 'Unified/split text-diff renderer: rows are diff lines, not records.',
  },
  {
    path: 'components/salary/SalaryTables.tsx',
    rules: ['table'],
    reason: 'Salary band chart rendered as a table (range bars against a shared ceiling) — a chart companion.',
  },
  {
    path: 'components/PermissionDebuggerPanel.tsx',
    rules: ['table'],
    reason: 'Permission × role evaluation matrix, like PermissionsPanel.',
  },
  {
    path: 'components/integrations/MigrationWizard.tsx',
    rules: ['table'],
    reason: 'Migration wizard review step: local, transient wizard state (same as app/import).',
  },
];

/** The Collection's own home: the one place these primitives belong. */
const COLLECTION_HOME = 'components/collection/';

export const RULES = ['table', 'data-table-styles', 'data-table-class', 'view-toggle', 'pagination'];

const RULE_HELP = {
  table: 'a hand-rolled `<table>`',
  'data-table-styles': '`dataTableStyles` (the pre-Collection table styling)',
  'data-table-class': 'the `.data-table` class',
  'view-toggle': 'a card/table `<ViewToggle>` flag pair (no `options=`)',
  pagination: 'a hand-wired `<Pagination>`',
};

// ── Scanning ─────────────────────────────────────────────────────────────────

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') collect(full, out);
    } else if (entry.name.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Blank out comments, keeping every newline so line numbers survive. Block and JSX
 * comments go whole; a `//` comment only when it starts a line or follows
 * whitespace/`;`/`{`, so `https://` inside a string is left alone.
 */
export function stripComments(text) {
  const noBlocks = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlocks.replace(/(^|[\s;{}])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** The opening tag starting at `start` (`<ViewToggle …>`), braces and quotes respected. */
function openingTag(text, start) {
  let depth = 0;
  let quote = null;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote && text[i - 1] !== '\\') quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/** Every offence in one file's text, as `{ rule, line }`. Pure. */
export function scanText(raw) {
  const text = stripComments(raw);
  const hits = [];
  const each = (rule, re, keep = () => true) => {
    for (const m of text.matchAll(re)) if (keep(m)) hits.push({ rule, line: lineAt(text, m.index) });
  };
  each('table', /<table\b/g);
  each('data-table-styles', /\bdataTableStyles\b/g);
  // `data-table` as a class token inside a className string/template (not `data-table-x`).
  each('data-table-class', /className=\{?\s*["'`][^"'`]*(?<![\w-])data-table(?![\w-])[^"'`]*["'`]/g);
  each('view-toggle', /<ViewToggle\b/g, (m) => !/\boptions\s*=/.test(openingTag(text, m.index)));
  each('pagination', /<Pagination\b/g);
  each('pagination', /from\s+['"][^'"]*components\/Pagination['"]/g);
  return hits;
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + escaped.replace(/\/\*\*$/, '/.*').replace(/\*\*/g, '.*').replace(/(?<!\.)\*/g, '[^/]*') + '$');
}

const EXCLUSIONS = PERMANENT_EXCLUSIONS.map((ex) => ({ ...ex, re: globToRegExp(ex.path) }));

function excluded(rel, rule) {
  return EXCLUSIONS.some((ex) => ex.re.test(rel) && (!ex.rules || ex.rules.includes(rule)));
}

/** Measure the tree: `{ counts: Map<file, {rule: n}>, sites: Map<"file|rule", line[]>, files: string[] }`. */
export function measure(root) {
  const counts = new Map();
  const sites = new Map();
  const files = [];
  for (const file of collect(root)) {
    const rel = relative(root, file).split('\\').join('/');
    files.push(rel);
    if (rel.startsWith(COLLECTION_HOME)) continue;
    for (const { rule, line } of scanText(readFileSync(file, 'utf8'))) {
      if (excluded(rel, rule)) continue;
      const entry = counts.get(rel) ?? {};
      entry[rule] = (entry[rule] ?? 0) + 1;
      counts.set(rel, entry);
      const k = `${rel}|${rule}`;
      sites.set(k, [...(sites.get(k) ?? []), line]);
    }
  }
  return { counts, sites, files };
}

// ── Allowlist ────────────────────────────────────────────────────────────────

function readAllowlist() {
  if (!existsSync(allowlistPath)) return null;
  const parsed = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  return new Map(Object.entries(parsed.entries ?? {}));
}

function writeAllowlist(map) {
  const entries = Object.fromEntries(
    [...map.entries()]
      .filter(([, rules]) => Object.keys(rules).length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, rules]) => [file, Object.fromEntries(RULES.filter((r) => rules[r] > 0).map((r) => [r, rules[r]]))]),
  );
  const body = {
    $comment: [
      'PRD 47 §7 check:collection-surfaces — SHRINK-ONLY allowlist of pre-Collection surfaces.',
      'Each entry is a debt: migrate the surface onto <Collection> / LocalCollection, then run',
      `"${UPDATE_HINT}" to remove/lower it. --update never adds or raises an entry.`,
      'Permanent PRD 47 §2 exclusions live in scripts/check-collection-surfaces.mjs, not here.',
      'Must be empty after W6.',
    ],
    entries,
  };
  writeFileSync(allowlistPath, JSON.stringify(body, null, 2) + '\n', 'utf8');
}

/** `[{ file, rule, was, now }]` for every file/rule whose measured count differs from the allowlist. */
export function compare(allowlist, counts) {
  const out = [];
  const files = new Set([...allowlist.keys(), ...counts.keys()]);
  for (const file of files) {
    const allowed = allowlist.get(file) ?? {};
    const measured = counts.get(file) ?? {};
    for (const rule of RULES) {
      const was = allowed[rule] ?? 0;
      const now = measured[rule] ?? 0;
      if (was !== now) out.push({ file, rule, was, now });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || RULES.indexOf(a.rule) - RULES.indexOf(b.rule));
}

const total = (map) => [...map.values()].reduce((sum, rules) => sum + Object.values(rules).reduce((s, n) => s + n, 0), 0);

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const { counts, sites, files } = measure(srcDir);

  // A permanent exclusion that matches nothing is a waiver for a surface that is gone.
  // A directory exclusion is checked on disk (it may hold no `.tsx` today, e.g. domains/canvas).
  const stale = EXCLUSIONS.filter((ex) =>
    ex.path.endsWith('/**') ? !existsSync(resolve(srcDir, ex.path.slice(0, -3))) : !files.includes(ex.path),
  );
  if (stale.length > 0) {
    console.error('❌  Permanent collection-surface exclusion(s) match no file — remove them from scripts/check-collection-surfaces.mjs:\n');
    for (const ex of stale) console.error(`  - ${ex.path}`);
    process.exit(1);
  }

  const allowlist = readAllowlist();

  if (allowlist === null) {
    if (!UPDATE) {
      console.error(`❌  No allowlist at ${relative(process.cwd(), allowlistPath)}. Seed it once with: ${UPDATE_HINT}`);
      process.exit(1);
    }
    writeAllowlist(counts);
    console.log(`✅  Collection-surfaces allowlist SEEDED: ${counts.size} file(s), ${total(counts)} offence(s).`);
    process.exit(0);
  }

  const diffs = compare(allowlist, counts);
  const raised = diffs.filter((d) => d.now > d.was);
  const lowered = diffs.filter((d) => d.now < d.was);

  if (raised.length > 0) {
    console.error(
      `❌  ${raised.length} collection surface(s) ${UPDATE ? 'are above the allowlist — not written; --update only shrinks it' : 'not on the allowlist or above their count'}:\n`,
    );
    for (const { file, rule, was, now } of raised) {
      const lines = sites.get(`${file}|${rule}`) ?? [];
      console.error(`  - ${file}  [${rule}] ${was} → ${now}: ${RULE_HELP[rule]}`);
      for (const line of lines) console.error(`      ${file}:${line}`);
    }
    console.error(
      '\n   A surface that browses a collection of records renders through the ONE <Collection>\n' +
        '   (components/collection/Collection.tsx) — or LocalCollection (components/pm/LocalCollection.tsx)\n' +
        '   for in-memory rows. It owns Card | List, sort, paging, selection and the bulk bar.\n' +
        '   A `<ViewToggle options={…}>` mode-picker is allowed. See PRD 47 §2/§7 in docs/specs/platform.md.\n',
    );
    process.exit(1);
  }

  if (UPDATE) {
    if (lowered.length === 0) {
      console.log('✅  Collection-surfaces allowlist already matches the tree — nothing to record.');
      process.exit(0);
    }
    writeAllowlist(counts);
    for (const { file, rule, was, now } of lowered) console.log(`📉  ${file} [${rule}]: ${was} → ${now}`);
    console.log(`📝  Allowlist written: ${counts.size} file(s), ${total(counts)} offence(s).`);
    process.exit(0);
  }

  if (lowered.length > 0) {
    console.error(`✅→❌  ${lowered.length} allowlist entr(ies) shrank — record the win so the list only ever shrinks:\n`);
    for (const { file, rule, was, now } of lowered) console.error(`  - ${file} [${rule}]: ${was} → ${now}`);
    console.error(`\n   Run: ${UPDATE_HINT}\n`);
    process.exit(1);
  }

  console.log(`✅  Collection surfaces OK — ${counts.size} allowlisted file(s), ${total(counts)} offence(s), none new.`);
}

// Run only when executed, so the pure scanner above can be imported on its own.
const invoked = process.argv[1] ? resolve(process.argv[1]).toLowerCase() : '';
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) main();
