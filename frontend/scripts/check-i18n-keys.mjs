#!/usr/bin/env node
/**
 * Every `t('…')` a component renders exists in the catalog.
 *
 * `messages.test.ts` guards the catalogs against each other — the four
 * translations have exactly the keys `en` has, and every message's ICU parses.
 * Neither test can see the failure that actually reaches a reader, because it
 * lives in the SOURCE rather than in the catalog: a component calls
 * `t('usePromptCopy')` for a key nobody ever added, next-intl falls back to the
 * dotted path, and the product renders the literal string
 * `promptsPage.usePromptCopy` where a button label belongs. That is how the
 * prompt library's detail panel shipped with eleven raw keys down its side, and
 * a sweep for the same shape found 393 of them across 27 files.
 *
 * The two guards are complementary and both are needed:
 *
 *   catalog → catalog   messages.test.ts   "zh has exactly the keys en has"
 *   source  → catalog   THIS FILE          "every key a component asks for exists"
 *
 * Only `en` is resolved against, because the parity test above makes the other
 * four catalogs identical in shape by construction — a key present here is
 * present in all five or that test is already red.
 *
 * Run via `npm run check:i18n-keys`; wired into `npm test` with the other guards.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');
const catalog = JSON.parse(readFileSync(resolve(srcDir, 'i18n/messages/en.json'), 'utf8'));

/** The node at a dotted path, or `undefined`. Messages are strings; a `raw` may be any node. */
function lookup(path) {
  let node = catalog;
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object' || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

/**
 * `const t = useTranslations('ns')`, and the server's `await getTranslations('ns')`.
 *
 * A namespace-less `useTranslations()` is matched too and binds the ROOT, which
 * is correct rather than a special case: keys are then written absolute.
 */
const BINDING = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:'([^']*)')?\s*\)/g;

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const missing = [];

for (const file of collect(srcDir)) {
  const rel = relative(srcDir, file).split('\\').join('/');
  const text = readFileSync(file, 'utf8').replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');

  /**
   * A file may bind the same name twice — two components in one module, each
   * with `const t = …`. Which binding a given call site sees needs a scope
   * analysis this guard deliberately does not do, so a name collects EVERY
   * namespace it is bound to and a key that resolves under any of them passes.
   * That direction of error is the safe one: it can miss, it cannot cry wolf.
   */
  const namespaces = new Map();
  for (const [, name, ns] of text.matchAll(BINDING)) {
    if (!namespaces.has(name)) namespaces.set(name, new Set());
    namespaces.get(name).add(ns ?? '');
  }
  if (namespaces.size === 0) continue;

  for (const [name, bound] of namespaces) {
    // `t('key')`, `t.rich('key')`, `t.raw('key')`, `t.markup('key')`. `t.has()`
    // is an existence PROBE — asking about a key that may legitimately not
    // exist is the whole point of it — so it is not a render and not checked.
    const call = new RegExp(`\\b${name}(\\.rich|\\.raw|\\.markup|\\.has)?\\(\\s*'([^']*)'\\s*([),])`, 'g');
    for (const match of text.matchAll(call)) {
      const [, method = '', key] = match;
      if (method === '.has') continue;
      // A key assembled at runtime — `t('cause.' + name)` — cannot be resolved
      // here. The registry-backed lists in `messages.test.ts` are where those
      // are proven, by enumerating the registry that supplies the suffix.
      if (match[3] === ')' && key.endsWith('.')) continue;

      const resolved = [...bound].some((ns) => {
        const node = lookup(ns ? `${ns}.${key}` : key);
        return method === '.raw' ? node !== undefined : typeof node === 'string';
      });
      if (resolved) continue;

      const line = text.slice(0, match.index).split('\n').length;
      const shown = [...bound].map((ns) => (ns ? `${ns}.${key}` : key)).join(' | ');
      missing.push(`${rel}:${line}  ${shown}`);
    }

    /**
     * A key finished at RUNTIME — t(`campaigns.blocker.${b}`). The suffix is
     * unknowable here, but the prefix is not: it has to name an object in the
     * catalog, and when it does not, every value of the suffix renders a raw
     * key. Checking the prefix costs nothing and cannot cry wolf. Checking the
     * suffixes belongs to `messages.test.ts`, which enumerates the registry
     * that supplies them — the growth page shipped `campaigns.blocker.name`
     * with no such enumeration and rendered the dotted path to readers.
     */
    const dynamic = new RegExp(
      '\\b' + name + '(?:\\.rich|\\.raw|\\.markup)?\\(\\s*`([^`$]*)\\$\\{',
      'g',
    );
    for (const match of text.matchAll(dynamic)) {
      // t(`${x}.label`) has no static prefix to resolve.
      if (!match[1].includes('.')) continue;
      const path = match[1].slice(0, match[1].lastIndexOf('.'));
      const resolved = [...bound].some((ns) => {
        const node = lookup(ns ? `${ns}.${path}` : path);
        return typeof node === 'object' && node !== null;
      });
      if (resolved) continue;

      const line = text.slice(0, match.index).split('\n').length;
      const shown = [...bound].map((ns) => (ns ? `${ns}.${path}` : path)).join(' | ');
      missing.push(`${rel}:${line}  ${shown}.<runtime suffix> — namespace missing`);
    }
  }
}

if (missing.length > 0) {
  const byFile = new Map();
  for (const entry of missing) {
    const file = entry.split(':')[0];
    byFile.set(file, (byFile.get(file) ?? 0) + 1);
  }
  console.error(`❌  ${missing.length} translation key(s) a component renders are not in the catalog:\n`);
  for (const entry of [...new Set(missing)]) console.error(`    • ${entry}`);
  console.error(`\n  ${byFile.size} file(s) affected.\n`);
  console.error('    next-intl renders the DOTTED PATH when a message is missing, so every');
  console.error('    one of these is a raw key sitting in the UI where a label belongs.');
  console.error('');
  console.error('    Add the key to ALL FIVE catalogs in src/i18n/messages/ with a real');
  console.error('    translation in each — en.json alone turns this guard green and leaves');
  console.error("    the parity test in messages.test.ts red. Reuse `common.*` for a string");
  console.error('    that already exists there rather than adding a second copy of it.');
  console.error('');
  process.exit(1);
}

console.log('✅  Every translation key rendered by a component resolves in the catalog.');
