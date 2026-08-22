#!/usr/bin/env node
/**
 * DRY ratchet — a second implementation of a shared primitive must fail the build.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The DRY rule in this codebase is not "do not repeat yourself" in the abstract;
 * it is "extract the primitive AND migrate every duplicate in the same pass".
 * The failure mode it guards against is specific and has happened: a primitive
 * is built, the duplicates are noticed, and they are LOGGED to the roadmap as
 * follow-up work instead of migrated. The result is worse than before — three
 * implementations where there were two, one of them now billed as canonical —
 * and nothing fails, because every one of them compiles and passes its own test.
 *
 * The calendar is the case this was written from. `components/calendar/` was
 * built as the one calendar; `components/ScheduleCalendar.tsx` and
 * `components/meetings/MeetingsCalendar.tsx` each kept drawing their own month
 * grid (the second one drew TWO), and a register entry stood in for the work.
 * A guard is what makes that unrepeatable, because a guard does not accept
 * "out of scope".
 *
 * ── HOW IT DECIDES ───────────────────────────────────────────────────────────
 * Each primitive declares SIGNALS: the load-bearing shapes a re-implementation
 * cannot avoid. A seven-column CSS grid, a 42-cell month, week-start arithmetic
 * off `getDay()`, an hour-row loop. Any one of those alone is innocent — a
 * seven-column grid is a perfectly good weekday summary — so a file violates
 * only at `threshold` DISTINCT signals. That is deliberately a heuristic and
 * deliberately tuned to be quiet: a guard that cries wolf on a weekday header is
 * a guard someone adds to the baseline out of irritation, and then it protects
 * nothing.
 *
 * A file inside the primitive's own `owner` directory is never a violation —
 * that IS the primitive. Neither is a test, which may build any shape it likes
 * to assert against.
 *
 * ── RATCHET, NOT A WALL ──────────────────────────────────────────────────────
 * Same contract as `check-layering.mjs`: a NEW violation fails, and a baseline
 * entry that no longer violates ALSO fails, so the list cannot keep stale debt.
 * The baseline starts EMPTY, which is the point of landing it the same day the
 * last duplicate was migrated: the first entry anyone adds has to be argued for
 * in a diff, with a reason, in review.
 *
 * ── ADDING A PRIMITIVE ───────────────────────────────────────────────────────
 * One entry in `PRIMITIVES` below. Signals should be things a re-implementation
 * MUST contain rather than things it happens to contain — a class name is the
 * wrong signal (it can be renamed), the geometry is the right one (it cannot).
 * Before adding one, check it against the implementations it is meant to catch:
 * `git show <rev>:<path> | node scripts/check-primitive-duplication.mjs --stdin <path>`.
 *
 * Run via `npm run check:primitives`; wired into `npm test` through
 * `scripts/checks.manifest.mjs`. `--update` rewrites the baseline.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');
const baselineFile = resolve(here, '.primitive-baseline.txt');

const UPDATE = process.argv.includes('--update');
/** `--stdin <label>` scores one file read from stdin. For checking a signal set
 *  against an implementation that has already been deleted. */
const STDIN_AT = process.argv.indexOf('--stdin');

/**
 * The shared primitives, and what a re-implementation of each looks like.
 *
 * `owner` is the directory that IS the primitive — files under it are exempt by
 * construction, so the primitive is never a violation of itself.
 */
const PRIMITIVES = [
  {
    id: 'calendar-grid',
    owner: 'components/calendar/',
    primitive: 'components/calendar/Calendar.tsx',
    why:
      'A day / week / month grid belongs to the ONE calendar. Three of these existed at once —\n' +
      '   the canvas surface, ScheduleCalendar and MeetingsCalendar (which had two) — and each\n' +
      '   had its own lane packing, its own overflow rule and its own drag handling, so a fix to\n' +
      '   any of them reached one third of the product.',
    fix:
      'Render <Calendar> from @/components/calendar/Calendar and hand it CalendarEvents. What is\n' +
      '   genuinely yours — the reading, the colour rule, what a click means, per-slot shading —\n' +
      '   is props. See components/ScheduleCalendar.tsx (90 lines) for the shape.',
    threshold: 2,
    signals: [
      // Seven columns of days, however it is spelled — CSS grid, inline style, or a
      // template literal building one.
      { name: 'seven-column day grid', test: /repeat\(\s*\$?\{?\s*(?:7|COLS)\b/ },
      // The six-week month. 42 cells is the shape every paper calendar settled on and
      // no re-implementation avoids it.
      { name: 'six-week month (42 cells)', test: /\b42\b\s*\}|DAYS_IN_GRID|length:\s*42/ },
      // Week-start arithmetic: back up to the first day of the week off `getDay()`.
      { name: 'week-start arithmetic', test: /setDate\([^)]*getDay\(\)/ },
      // An hour-row grid — the day/week reading.
      { name: 'hour-row grid', test: /HOUR_START|HOUR_END|hourRow|hourCell|SLOT_MIN/ },
      // Lane packing: the "which row does this bar sit on" loop a month grid needs
      // once entries can span days.
      { name: 'span lane packing', test: /MAX_LANES|laneCount|\blanes\[/ },
      // The "+N more" overflow every month cell grows the moment it has a cap.
      { name: 'day-cell overflow count', test: /moreItems|\+\{?\s*(?:hidden|overflow)/ },
      // Monday-first normalisation. The canvas month grid spelled its week start this
      // way rather than through `setDate(getDay())`, and scored 1/2 on the first draft
      // of this list — which is the whole reason the signals below exist. A signal set
      // is only worth what it catches, so it was measured against all three
      // implementations before landing (see the `--stdin` note in the header).
      { name: 'Monday-first weekday index', test: /getDay\(\)[^;\n)]*%\s*7|%\s*7[^;\n]*getDay\(\)/ },
      // A day cell that belongs to the month either side, dimmed. Only a month grid has
      // days it is drawing and not about.
      { name: 'outside-month day cells', test: /inMonth|data-outside|outsideMonth/ },
      // The weekday header row a seven-column grid grows the moment it means days.
      { name: 'weekday header row', test: /weekday:\s*['"](?:short|narrow)['"]/ },
    ],
  },
  {
    id: 'tenant-override-card',
    owner: 'components/admin/TenantOverrideCard.tsx',
    primitive: 'components/admin/TenantOverrideCard.tsx',
    why:
      'The per-tenant superadmin overrides are the same card with different controls. The premium\n' +
      "   flag copied the token cap — its own comment said \"Mirrors TenantTokenLimitOverrideEditor\" —\n" +
      '   and carried its own saving/error state, its own card chrome and its own stopPropagation on\n' +
      '   a Save button that sits inside a clickable tenant row. A third override would have copied\n' +
      '   whichever of the two its author happened to open.',
    fix:
      'Render <TenantOverrideCard> from @/components/admin/TenantOverrideCard and pass your own\n' +
      '   controls as `children(saving)`. It owns the frame, the save, `saving` and the error; you\n' +
      '   own the mode controls and what dirty means. See TenantPremiumOverrideEditor.tsx (two\n' +
      '   radios) and TenantIntegerOverrideEditor.tsx (three radios + a number input).',
    // Its callers keep the domain vocabulary the signals below look for — an
    // override editor still fires its own PATCH and still names its own i18n
    // keys, because that is the part it OWNS. A file that imports the card is
    // using it, so importing is the exemption; only a hand-rolled one scores.
    exemptImporters: true,
    threshold: 2,
    signals: [
      // The per-tenant PATCH an override editor fires itself.
      { name: 'per-tenant override PATCH', test: /adminApi\.setTenant\w*Override/ },
      // The i18n namespace the overrides live in.
      { name: 'tenant override i18n keys', test: /['"]tenants\.\w*[Oo]verride\./ },
      // A radio group named per tenant — what you write when the card is repeated
      // down a list of tenants and the groups must not collide.
      { name: 'per-tenant radio group', test: /name=\{`[^`]*\$\{tenantId\}`\}/ },
      // Save inside a clickable tenant row. Nothing else in this card needs it.
      { name: 'stopPropagation on save', test: /stopPropagation\(\)[\s\S]{0,120}void\s+save\(\)/ },
    ],
  },
];

/** The module name a caller would import the primitive by, e.g. `TenantOverrideCard`. */
function primitiveModule(primitive) {
  return primitive.primitive.replace(/^.*\//, '').replace(/\.[jt]sx?$/, '');
}

function collect(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Repo-relative, forward-slashed — the baseline key. */
const key = (file) => relative(srcDir, file).split('\\').join('/');

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /(?:^|\s)\/\/[^\n]*/g;

/**
 * Which of a primitive's signals a file carries.
 *
 * Comments are stripped first, so a file that DOCUMENTS the primitive — this
 * script, an adapter explaining what it no longer draws, a DONE.md-style header
 * — is scored on its code rather than on its prose. Getting that wrong would
 * punish exactly the files that did the right thing.
 */
function signalsIn(text, primitive, consumers) {
  const code = text.replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');
  // Opt-in per primitive, because it is a real loosening: a file could import the
  // primitive AND still draw its own copy beside it. It is right only where the
  // signals are DOMAIN vocabulary that a legitimate caller keeps — an override
  // editor still owns its own PATCH and its own i18n keys — rather than the
  // primitive's own shape, which a caller has no reason to restate.
  if (primitive.exemptImporters && consumers && importsAny(code, consumers)) return [];
  return primitive.signals.filter((signal) => signal.test.test(code)).map((signal) => signal.name);
}

/** Does this code import a module with one of these basenames? */
function importsAny(code, moduleNames) {
  for (const name of moduleNames) {
    if (new RegExp(`from\\s+['"][^'"]*/${name}['"]`).test(code)) return true;
  }
  return false;
}

/**
 * Every module that reaches the primitive, transitively.
 *
 * One level is not enough. `TenantTokenLimitOverrideEditor` is a thin config over
 * `TenantIntegerOverrideEditor`, which is what actually renders the card — it is
 * two hops from the primitive and as far from a re-implementation as a file can
 * be, and a one-hop rule reported it as the duplicate.
 *
 * @param {object} primitive
 * @param {Map<string, string>} texts Repo-relative path → file text.
 * @returns {Set<string>} Module basenames, the primitive's own included.
 */
function consumersOf(primitive, texts) {
  const names = new Set([primitiveModule(primitive)]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [relPath, text] of texts) {
      const base = relPath.replace(/^.*\//, '').replace(/\.[jt]sx?$/, '');
      if (names.has(base)) continue;
      if (!importsAny(text, names)) continue;
      names.add(base);
      grew = true;
    }
  }
  return names;
}

if (STDIN_AT !== -1) {
  const label = process.argv[STDIN_AT + 1] ?? '<stdin>';
  const text = readFileSync(0, 'utf8');
  for (const primitive of PRIMITIVES) {
    const hits = signalsIn(text, primitive);
    console.log(
      `${label} vs ${primitive.id}: ${hits.length}/${primitive.threshold} → ` +
        `${hits.length >= primitive.threshold ? 'VIOLATION' : 'clean'}` +
        (hits.length ? `  [${hits.join(', ')}]` : ''),
    );
  }
  process.exit(0);
}

const files = collect(srcDir).filter((file) => !/\.(test|spec)\.tsx?$/.test(key(file)));
const current = new Map();

// Read once: the transitive consumer sets need the whole tree in hand before any
// single file can be scored.
const texts = new Map(files.map((file) => [key(file), readFileSync(file, 'utf8')]));
const consumers = new Map(
  PRIMITIVES.filter((primitive) => primitive.exemptImporters).map((primitive) => [
    primitive.id,
    consumersOf(primitive, texts),
  ]),
);

for (const [relPath, text] of texts) {
  for (const primitive of PRIMITIVES) {
    if (relPath.startsWith(primitive.owner)) continue;
    const hits = signalsIn(text, primitive, consumers.get(primitive.id));
    if (hits.length < primitive.threshold) continue;
    current.set(`${primitive.id} :: ${relPath}`, { primitive, relPath, hits });
  }
}

if (UPDATE) {
  const header =
    '# Files that re-implement a shared primitive. This list may only SHRINK.\n' +
    '# Every entry is debt with a name — see scripts/check-primitive-duplication.mjs.\n' +
    '# Regenerate with: node scripts/check-primitive-duplication.mjs --update\n';
  writeFileSync(
    baselineFile,
    header + [...current.keys()].sort().join('\n') + (current.size ? '\n' : ''),
    'utf8',
  );
  console.log(`Baseline rewritten: ${current.size} duplicate(s).`);
  process.exit(0);
}

const baseline = new Set(
  existsSync(baselineFile)
    ? readFileSync(baselineFile, 'utf8')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
    : [],
);

const added = [...current.keys()].filter((entry) => !baseline.has(entry)).sort();
const cleaned = [...baseline].filter((entry) => !current.has(entry)).sort();

let failed = false;

if (added.length > 0) {
  failed = true;
  console.error(`❌  A shared primitive has been re-implemented (${added.length}):\n`);
  for (const entry of added) {
    const { primitive, relPath, hits } = current.get(entry);
    console.error(`      - ${relPath}`);
    console.error(`        looks like a second '${primitive.id}': ${hits.join(', ')}`);
    console.error(`        the one implementation is ${primitive.primitive}`);
    console.error(`\n   ${primitive.why}\n\n   Fix = ${primitive.fix}\n`);
  }
  console.error(
    '   Extracting a primitive without migrating the duplicates leaves MORE\n' +
      '   implementations than you started with, not fewer. A roadmap entry is not a\n' +
      '   migration. If this file genuinely is not a duplicate, add it to\n' +
      '   scripts/.primitive-baseline.txt WITH a reason in the commit — the list is the review.\n',
  );
}

if (cleaned.length > 0) {
  failed = true;
  console.error(`✅→❌  ${cleaned.length} baseline entr(ies) no longer duplicate — remove them so the ratchet holds:\n`);
  for (const entry of cleaned) console.error(`      - ${entry}`);
  console.error('\n   Delete those lines from scripts/.primitive-baseline.txt (or run: node scripts/check-primitive-duplication.mjs --update).\n');
}

if (failed) process.exit(1);

console.log(
  `✅  Primitive-duplication ratchet OK — ${PRIMITIVES.length} primitive(s) watched across ` +
    `${files.length} file(s), ${current.size} known duplicate(s), 0 new.`,
);
