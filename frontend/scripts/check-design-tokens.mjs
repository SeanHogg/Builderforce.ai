#!/usr/bin/env node
/**
 * Design-system contract guard — two checks, one failure mode.
 *
 * Both catch a reference to something the design system does not actually
 * define, which the browser resolves by silently doing nothing.
 *
 *   1. TOKENS  — every `var(--x)` must name a DECLARED custom property.
 *   2. CLASSES — every static `ui-*` class in a `className` must name a
 *      DECLARED `.ui-*` rule.
 *
 * Every `var(--x)` in the app must name a custom property that is actually
 * DECLARED. An undeclared one fails in two ways, and both are invisible in the
 * theme the author happened to be looking at:
 *
 *   - `var(--nope)` with no fallback is invalid at computed-value time, so the
 *     whole declaration is dropped. `border: 1px solid var(--border-color)`
 *     rendered NO BORDER, and `font-family: var(--mono)` silently fell back to
 *     the body font.
 *   - `var(--nope, #a78bfa)` always paints the literal, in BOTH themes. That is
 *     a hardcoded single-theme colour wearing a token's clothes — which is
 *     exactly what the theme rule exists to prevent.
 *
 * This is not hypothetical, and it has now happened twice. The `danger-*` /
 * `info-*` families were used at ~30 call sites while undeclared, and every one
 * painted a pale-pink block in dark mode (see the comment on --danger in
 * globals.css). A later audit found 42 more undeclared names across 55 files:
 * 45 bare references that rendered nothing, and 96 that were locked to one
 * theme — including a `--surface-coral` whose fallback was the RETIRED orange
 * brand colour, painting an orange button into a blue product.
 *
 * Fixing those is cheap. Finding them is not, because nothing fails — so the
 * ratchet lives here.
 *
 * The CLASS check exists for the same reason. `<Surface>` shipped
 * `ui-surface--panel` and `<Button>` shipped `ui-button--md` on every render;
 * neither rule exists, because the DEFAULT tone/size is carried by the base
 * `.ui-surface` / `.ui-button` rule. Nothing broke visually — which is the
 * problem: a later hand-migration copied those emitted class strings verbatim
 * into two files, believing them to be the contract. A dead class is invisible
 * until someone trusts it.
 *
 * Run via `npm run check:design-tokens`; wired into `npm test`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');

/**
 * Token PREFIXES supplied by a host we do not control, so they are referenced
 * here but declared elsewhere. Every entry needs a reason.
 */
const EXTERNAL_PREFIXES = new Map([
  ['--vscode-', 'Injected by the VS Code webview host into the extension surfaces.'],
]);

/** `--x: value` in CSS, `'--x': value` in an inline-style object, and the
 *  computed-key form React needs for a dynamic property: `['--x' as string]:`. */
const DECLARATION = /(--[a-zA-Z0-9_-]+)["']?(?:\s+as\s+string)?["']?\s*\]?\s*:/g;
/** A `var()` reference, capturing the token and whatever fallback follows. */
const REFERENCE = /var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,([^;}\n]*))?\)/g;

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const JSDOC_LINE = /^\s*(\/\/|\*)\s.*$/gm;

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = collect(srcDir);
const declared = new Set();

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(DECLARATION)) declared.add(match[1]);
}

/** A fallback chain that ends in a real token is fine: `var(--a, var(--b))`. */
const resolvesToToken = (fallback) =>
  Boolean(fallback) && (fallback.match(/--[a-zA-Z0-9_-]+/g) ?? []).some((t) => declared.has(t));

const violations = [];

for (const file of files) {
  const rel = relative(srcDir, file).split('\\').join('/');
  // Strip comments so documentation like `var(--token)` is not read as code.
  const text = readFileSync(file, 'utf8').replace(BLOCK_COMMENT, '').replace(JSDOC_LINE, '');

  for (const match of text.matchAll(REFERENCE)) {
    const [, token, fallback] = match;
    if (declared.has(token)) continue;
    if ([...EXTERNAL_PREFIXES.keys()].some((p) => token.startsWith(p))) continue;
    if (resolvesToToken(fallback)) continue;

    const line = text.slice(0, match.index).split('\n').length;
    const kind = fallback === undefined ? 'renders nothing' : `locked to one theme (${fallback.trim()})`;
    violations.push(`${rel}:${line}  var(${token}) — ${kind}`);
  }
}

/* ---------------------------------------------------------------------------
 * Check 2: every static `ui-*` class must name a declared `.ui-*` rule.
 *
 * Only STATIC class strings are checkable — the primitives build their own
 * names (`ui-button--${variant}`), so any string carrying an interpolation is
 * skipped rather than guessed at. That is the right split: the primitives are
 * the source of truth, and this check polices everyone who hand-writes what the
 * primitives emit.
 * ------------------------------------------------------------------------- */

/** A `.ui-x` selector in CSS. Declares the class. */
const UI_CLASS_RULE = /\.(ui-[a-zA-Z0-9_-]+)/g;
/** `className="…"`, `className={'…'}` and the backtick form. */
const CLASS_ATTR =
  /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)\s*\})/g;

const declaredClasses = new Set();
for (const file of files) {
  if (!file.endsWith('.css')) continue;
  for (const match of readFileSync(file, 'utf8').matchAll(UI_CLASS_RULE)) {
    declaredClasses.add(match[1]);
  }
}

for (const file of files) {
  if (file.endsWith('.css')) continue;
  const rel = relative(srcDir, file).split('\\').join('/');
  const text = readFileSync(file, 'utf8').replace(BLOCK_COMMENT, '').replace(JSDOC_LINE, '');

  for (const match of text.matchAll(CLASS_ATTR)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
    // A template with an interpolation cannot be resolved statically.
    if (raw === undefined || raw.includes('${')) continue;

    for (const cls of raw.split(/\s+/).filter(Boolean)) {
      if (!cls.startsWith('ui-') || declaredClasses.has(cls)) continue;
      const line = text.slice(0, match.index).split('\n').length;
      violations.push(`${rel}:${line}  .${cls} — class has no CSS rule, so it does nothing`);
    }
  }
}

if (violations.length > 0) {
  console.error(`❌  Undeclared design-system references (${violations.length}):\n`);
  for (const v of violations) console.error('  - ' + v);
  console.error(
    '\n   Each name must resolve to a token declared in BOTH themes.' +
      '\n   Pick one:' +
      '\n     • the name is an ALIAS of something that exists → use the canonical' +
      '\n       token (--warning-text, --border, --font-mono, --surface-card …);' +
      '\n     • the name is a genuine GAP in a family → declare it in globals.css' +
      '\n       under BOTH :root and html[data-theme=\'light\'];' +
      '\n     • the host supplies it → add its prefix to EXTERNAL_PREFIXES in' +
      '\n       scripts/check-design-tokens.mjs WITH a reason.' +
      '\n   A literal fallback does NOT make it safe — it paints in both themes.' +
      '\n   For a `.ui-*` class: use the primitive in components/ui rather than' +
      '\n   hand-writing the class string, or declare the rule in globals.css.' +
      '\n   A DEFAULT variant has no modifier — the base rule already carries it.\n',
  );
  process.exit(1);
}

console.log(
  `✅  Design-system check passed — ${declared.size} tokens and ` +
    `${declaredClasses.size} ui-* classes declared, every reference resolves.`,
);
