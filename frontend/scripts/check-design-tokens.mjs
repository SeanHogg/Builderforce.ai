#!/usr/bin/env node
/**
 * Design-token guard.
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

if (violations.length > 0) {
  console.error(`❌  Undeclared design tokens (${violations.length} reference(s)):\n`);
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
      '\n   A literal fallback does NOT make it safe — it paints in both themes.\n',
  );
  process.exit(1);
}

console.log(`✅  Design-token check passed — ${declared.size} tokens declared, every reference resolves.`);
