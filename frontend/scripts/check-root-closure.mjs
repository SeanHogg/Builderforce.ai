#!/usr/bin/env node
/**
 * Root-closure ratchet: how much of `src/` the root layout statically imports.
 *
 * Every module reachable from `app/layout.tsx` through STATIC imports is parsed
 * on every first paint of every route — the task board, the whole API client,
 * the marketing content module, whether or not the page uses them. `dynamic()`
 * and `import()` cut an edge out of that closure; this guard makes sure nobody
 * quietly wires one back in.
 *
 * Walks `import … from '…'` and `export … from '…'` statements (type-only
 * imports excluded — they never bundle) starting at the root layout, resolving
 * `@/` and relative specifiers inside `src/`. Package imports are leaves.
 *
 *   node scripts/check-root-closure.mjs            # verify
 *   node scripts/check-root-closure.mjs --update   # re-baseline after cutting edges
 *
 * ── WHAT IS RATCHETED: THE FILE SET, BY NAME ─────────────────────────────────
 * `.root-closure-baseline.json` holds the sorted list of modules in the closure.
 * A module that appears in the closure and not in that list fails, by name; a
 * module that leaves fails as slack, the way every other `ratchetSet` guard in
 * this repo does. LINES are printed and not ratcheted.
 *
 * It used to ratchet two COUNTS, `{files, lines}`, both required to match
 * EXACTLY. That made the guard fire on things it does not care about and cannot
 * be fixed by the person who tripped it:
 *
 *   - `i18n/messages/en.json` is in the closure and is 28k of its 90k lines, so
 *     the house rule that every UI change ships its five catalogs in the same
 *     pass moved the line count on nearly every frontend commit.
 *   - Adding or deleting a COMMENT in any of 313 modules moved it too — see the
 *     "487 → 310" entry below, which had to explain fourteen lines of comment
 *     inside `lib/rbac.ts` and concluded, correctly, that "a raise this guard
 *     cares about is a new FILE, and there is none".
 *   - With several sessions writing this repo at once, a baseline measured
 *     before a commit was stale by the time the commit was made. That is not
 *     hypothetical: the 2026-09-07 `Deploy frontend` run failed on
 *     `312/90418` vs `312/90425` — the SAME 312 files, seven lines of somebody
 *     else's catalog additions — and the deploy was red for a change no part of
 *     which touched the import graph.
 *
 * A set is also STRICTER than the count it replaces, which is the point: swapping
 * one module in the closure for another of the same size used to pass, and now
 * names both. Nothing about "don't wire a new module into every first paint"
 * got easier; only the noise around it went away.
 *
 * Deliberate raises, so a name in the baseline always has an argument:
 *
 *   487 → 310 files / 121640 → 90106 lines (2026-09-07) — a CUT, recorded here
 *   because it is the largest this guard has taken and the next raise should be
 *   argued against the shape it leaves. `ConditionalAppShell` imported
 *   `WidgetBrainBridge` statically. That bridge renders null — it registers the
 *   `list_widgets` / `pin_widget` / `show_widget` / `answer_with_widgets` Brain
 *   actions and nothing else — but it calls `listComponents()`, so the edge
 *   dragged `lib/components/registry` → `allComponents` → EVERY registered
 *   surface (insights lenses, catalog, workforce, the canvas command set and
 *   `lib/canvasGridFit` under it) into the first paint of every route. 180
 *   modules and 32k lines to enumerate widget ids for a panel nobody had opened.
 *   It is now `dynamic(…, { ssr: false })` beside `ResumeWorkBridge` and the
 *   other render-null bridges, which is where a component with no markup and no
 *   pre-Brain purpose belonged. The three files that pushed this guard red
 *   (`AgentBenchmarkPanel`, `agentBenchmarkApi`, `canvasGridFit`) left the
 *   closure with it, as leaves of the registry rather than as a special case.
 *   The recorded line count was 90120 rather than 90106: the same 310 files, with
 *   the fourteen lines of comment the same pass added inside `lib/rbac.ts`. No
 *   edge moved — a raise this guard cares about is a new FILE, and there is none.
 *   That sentence is why the guard now ratchets the file set and not the lines.
 *
 *   313 → 314 files (2026-09-09) — `components/ui/ModalOverlay.tsx`, THE centred
 *   overlay every modal stands in. `ConfirmDialog` is already in the closure (the
 *   root layout mounts `ConfirmProvider`, which is the whole point of it — one
 *   shared instance, so `useConfirm()` resolves without a chunk), and until this
 *   pass it CARRIED this code inline: the `.modal-overlay` element, the
 *   `aria-modal` attributes, the backdrop-target check, the Escape listener and
 *   the portal to `<body>`. Those lines did not arrive in the first paint, they
 *   moved into a file with a name — the closure went 90723 → 90725 lines for a
 *   whole new module, which is the measure of it. Three other surfaces
 *   (`DeleteProjectDialog`, the ceremony stage, the guest account wall) had each
 *   written the same chrome slightly differently and now share this one; none of
 *   them is in the closure. `dynamic()` here would be worse than the edge: a
 *   confirmation modal that waits for a second chunk before it can be seen is a
 *   destructive prompt the reader is looking straight through. Kept OUT of the
 *   `components/ui` barrel deliberately — the barrel IS a closure edge, and an
 *   overlay has no business on a first paint that renders no modal.
 *
 *   313 → 314 files (2026-09-07) — `components/PanelCloseButton.tsx`, the ONE
 *   dismiss control every slide-out panel renders. It is in the closure for the
 *   same reason `SlideOutPanel` already is (the shell's own panels import it), and
 *   the edge is 35 lines that REPLACE the hand-rolled button `SlideOutPanel` used
 *   to inline — the closure grew by one NAME, not by any first-paint work. A
 *   `dynamic()` here would be worse than the edge it cuts: the close button is the
 *   first thing in a panel's header, so deferring it hands the reader a header
 *   with no way out of it until a second chunk lands.
 *
 *   482 → 483 files (2026-09-06) — `domains/guest/application/guestWall.ts`,
 *   the transport's record of "a read on this route was refused for want of a
 *   credential". `lib/apiClient.ts` is already in the closure and is the ONE
 *   place that fact is known, so the record must sit beside `resolveGuestRead`
 *   rather than behind an `import()` the throw path would have to await. The
 *   components that read it (`GuestAccountPrompt`, its `GuestSignupCta`) are cut
 *   out with `dynamic()` from both `AppShell` and `ui/SectionState`.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../src');
const root = resolve(src, 'app/layout.tsx');
const baselineFile = resolve(here, '.root-closure-baseline.json');
const UPDATE = process.argv.includes('--update');
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)[^'"]*?\sfrom\s+['"]([^'"]+)['"]/gm;
const SIDE_EFFECT_IMPORT = /^\s*import\s+['"]([^'"]+)['"]/gm;

function resolveSpecifier(from, spec) {
  let base;
  if (spec.startsWith('@/')) base = resolve(src, spec.slice(2));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = resolve(dirname(from), spec);
  else return null; // a package — a leaf of this graph
  const candidates = [base, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => resolve(base, 'index' + e))];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const seen = new Map(); // abs path → line count
const queue = [root];
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  const text = readFileSync(file, 'utf8');
  seen.set(file, text.split('\n').length);
  if (/\.(css|json)$/.test(file)) continue;
  const specs = new Set();
  for (const m of text.matchAll(STATIC_IMPORT)) specs.add(m[1]);
  for (const m of text.matchAll(SIDE_EFFECT_IMPORT)) specs.add(m[1]);
  for (const spec of specs) {
    const target = resolveSpecifier(file, spec);
    if (target && !seen.has(target)) queue.push(target);
  }
}

const closure = [...seen.keys()].map((f) => relative(src, f).split(sep).join('/')).sort();
const lines = [...seen.values()].reduce((a, b) => a + b, 0);
const heaviest = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  .map(([f, n]) => `      ${String(n).padStart(6)}  ${relative(src, f).split(sep).join('/')}`).join('\n');

if (UPDATE) {
  writeFileSync(baselineFile, JSON.stringify({ files: closure }, null, 2) + '\n');
  console.log(`✅ root closure baseline rewritten: ${closure.length} files / ${lines} lines`);
  process.exit(0);
}

const stored = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : null;
if (!Array.isArray(stored?.files)) {
  console.error([
    '❌  The root-closure baseline is missing, or still holds the old {files,lines} COUNTS.',
    '',
    "   It records the file SET now — see this file's header for why. Write it once:",
    '   node scripts/check-root-closure.mjs --update',
    '',
  ].join('\n'));
  process.exit(1);
}

const baseline = new Set(stored.files);
const current = new Set(closure);
const added = closure.filter((f) => !baseline.has(f));
const removed = stored.files.filter((f) => !current.has(f));

const list = (paths) => paths.slice(0, 20).map((f) => `     • ${f}`).join('\n')
  + (paths.length > 20 ? `\n     … and ${paths.length - 20} more` : '');

if (added.length) {
  console.error([
    `❌  ${added.length} module(s) are newly reachable from app/layout.tsx through STATIC imports:`,
    '',
    list(added),
    '',
    '   Every one of them is parsed on the first paint of every route. Load it with',
    '   next/dynamic (or an import() inside the handler that needs it) instead of a static',
    '   import, or — if the edge is genuinely load-bearing for the shell — re-baseline',
    "   deliberately AND argue the raise in this file's header:",
    '   node scripts/check-root-closure.mjs --update',
    '',
    `   The closure is now ${closure.length} files / ${lines} lines. Heaviest modules:`,
    heaviest,
    '',
  ].join('\n'));
  process.exit(1);
}
if (removed.length) {
  console.error([
    `✅→❌  ${removed.length} module(s) left the root closure — lower the baseline so the ratchet holds:`,
    '',
    list(removed),
    '',
    '   node scripts/check-root-closure.mjs --update',
    '',
  ].join('\n'));
  process.exit(1);
}
console.log(`✅ root closure: ${closure.length} files / ${lines} lines (at baseline)`);
