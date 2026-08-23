/**
 * check-canvas-kind-labels — a declared canvas kind must have a word in every language.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ──────────────────────────────────────────────
 * `CREATION_OBJECT_KINDS` (packages/creation-canvas-contract) is the vocabulary of the
 * board. Every kind in it reaches a palette entry, a card header and an outline row, and
 * each of those renders `creationCanvas.object.<kind>` — so a kind added to the contract
 * with no catalog entry ships as the raw dotted key, IN ALL FIVE LANGUAGES AT ONCE.
 *
 * It has happened twice. Thirteen kinds shipped unlabelled on 2026-08-19; `brandKit` and
 * `audience` did the same on 2026-08-20. Both times the contract change was correct and
 * complete on its own terms — the vocabulary and its words simply shipped one commit
 * apart.
 *
 * ── WHY IT IS A GUARD AND NOT A VITEST CASE ─────────────────────────────────────
 * The assertion existed, inside `messages.test.ts` — a 484-line suite that imports five
 * ~892 KB catalogs and takes ~20s. That is the wrong instrument for this property twice
 * over. It is slow enough that nobody runs it while editing a contract, and it is filed
 * under "message catalogs" rather than under the vocabulary it actually protects, so the
 * failure names the wrong subject.
 *
 * As a guard it runs in `pnpm run check` (~milliseconds, concurrent with fifteen others),
 * which the Deploy frontend job runs on every release — so a contract-package change now
 * fails the deploy that would have shipped it, with a message naming the kind and the
 * catalogs missing it.
 *
 * The assertion CANNOT move into the contract package itself, and that is deliberate
 * rather than a compromise: the catalogs live in `frontend`, so an assertion there would
 * make the contract package import its own consumer — a dependency edge pointing the
 * wrong way through the layering the architecture rule sets out. The contract declares
 * the vocabulary; the surface that renders it owns proving it has words.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────
 * Every kind in `CREATION_OBJECT_KINDS` has a non-empty STRING at
 * `creationCanvas.object.<kind>` in all five catalogs. A legacy kind that
 * `RENAMED_OBJECT_KINDS` maps away is exempt — it is a read-path alias, never offered.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const contractDir = join(repoRoot, 'packages', 'creation-canvas-contract', 'src');
const messagesDir = resolve(here, '..', 'src', 'i18n', 'messages');
const LOCALES = ['en', 'zh', 'es', 'fr', 'de'];

/**
 * Every `export const *_OBJECT_KINDS = [...]` in the contract package, read as SOURCE.
 *
 * Reading the text rather than importing it is what keeps this a guard: the contract is
 * TypeScript with cross-file imports, so importing it needs a transpiler and the ~2s that
 * costs is most of the budget for the whole check chain. The shape being parsed is a flat
 * array of single-quoted string literals, which is the shape the contract has always had
 * and which `check-canvas-glossary.mjs` already relies on for the same reason.
 *
 * Spread elements (`...MARKETING_OBJECT_KINDS`) are skipped deliberately — the array they
 * name is itself an `*_OBJECT_KINDS` export in this same directory, so it is collected on
 * its own pass and nothing is lost. That also means a kind list can move file without
 * this guard noticing or caring.
 */
function declaredKinds() {
  const kinds = new Set();
  const sources = readdirSync(contractDir).filter((name) => name.endsWith('.ts'));
  for (const name of sources) {
    const text = readFileSync(join(contractDir, name), 'utf8');
    for (const match of text.matchAll(/export const [A-Z_]*OBJECT_KINDS\s*=\s*\[([\s\S]*?)\]\s*as const/g)) {
      // Comments inside the array are prose about the kinds, and prose contains
      // apostrophes and quoted words — stripping them first is what stops
      // "the `scene3d` SURFACE" from being read as a kind.
      const body = match[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      for (const [, kind] of body.matchAll(/'([a-zA-Z][\w-]*)'/g)) kinds.add(kind);
    }
  }
  return kinds;
}

/** The kinds a read path accepts but no surface offers — never palette entries. */
function renamedAwayKinds() {
  const text = readFileSync(join(contractDir, 'index.ts'), 'utf8');
  const block = text.match(/RENAMED_OBJECT_KINDS[^=]*=\s*\{([\s\S]*?)\n\}/);
  if (!block) return new Set();
  const body = block[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return new Set([...body.matchAll(/^\s*([a-zA-Z][\w-]*)\s*:/gm)].map(([, key]) => key));
}

const catalogs = Object.fromEntries(
  LOCALES.map((locale) => [locale, JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), 'utf8'))]),
);

const kinds = declaredKinds();
const renamed = renamedAwayKinds();

if (kinds.size === 0) {
  console.error('❌  Canvas kind labels: no *_OBJECT_KINDS array was found in the contract package.');
  console.error('    Either the export was renamed or its shape changed — this guard is now blind and must be updated.');
  process.exit(1);
}

const violations = [];
for (const kind of [...kinds].sort()) {
  if (renamed.has(kind)) continue;
  const missing = LOCALES.filter((locale) => {
    const label = catalogs[locale]?.creationCanvas?.object?.[kind];
    return typeof label !== 'string' || label.trim() === '';
  });
  if (missing.length > 0) violations.push({ kind, missing });
}

if (violations.length > 0) {
  console.error(`❌  Canvas kind labels: ${violations.length} declared kind(s) have no word in every catalog.`);
  console.error('    A kind with no label renders as `creationCanvas.object.<kind>` on the palette, the card and the outline — in all five languages at once.\n');
  for (const { kind, missing } of violations) {
    console.error(`    ${kind}  →  missing in ${missing.join(', ')}`);
  }
  console.error('\n    Add `creationCanvas.object.<kind>` to frontend/src/i18n/messages/{en,zh,es,fr,de}.json with a REAL translation in each.');
  process.exit(1);
}

console.log(`✅  Canvas kind labels — ${kinds.size - renamed.size} declared kinds, every one labelled in all ${LOCALES.length} catalogs.`);
