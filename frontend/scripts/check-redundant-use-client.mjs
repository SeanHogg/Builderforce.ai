/**
 * `'use client'` marks a BOUNDARY: the module where a server component's import
 * crosses into client code. A module imported only from the client side is client
 * code already; a directive on it marks nothing, and it is what used to drive the
 * retired `'use client' files` count ratchet (1001 files, 710 of them redundant)
 * into failing builds whenever a feature added a component. So the rule is now the
 * boundary itself: a directive must have a server-side importer, or no importer at
 * all (an entry — a page, a layout, `error.tsx`), or this check fails.
 *
 * "Client side" is computed, not read off the directive: a module is client side if
 * it carries the directive, or if it has importers and every one of them is client
 * side (a barrel or helper reached only from client code). Least fixpoint, so a
 * cycle with no client entry stays server side — the conservative answer.
 *
 * Importers are static `import`/`export … from` and dynamic `import()` in
 * production modules under `src/`. Tests are not importers. A type-only import from
 * a server module still counts as a server importer — conservative again: it keeps
 * a directive that could go, never strips one that must stay.
 *
 * Reusing a component from a server module: add the directive back. Next fails the
 * build loudly if a server import reaches hooks without one, so this cannot ship a
 * broken page — and this check will then (correctly) consider it a boundary.
 *
 *   node scripts/check-redundant-use-client.mjs         # report, exit 1 if any
 *   node scripts/check-redundant-use-client.mjs --fix   # strip them
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../src');
const fix = process.argv.includes('--fix');

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.(?:test|spec)\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const rel = (file) => relative(src, file).split('\\').join('/');
const source = new Map(collect(src).map((file) => [rel(file), readFileSync(file, 'utf8')]));
const DIRECTIVE = /^\s*['"]use client['"];?[^\S\r\n]*(?:\r?\n)?(?:[^\S\r\n]*\r?\n)?/;
const hasDirective = (file) => DIRECTIVE.test(source.get(file));

function resolveSpecifier(from, specifier) {
  let base;
  if (specifier.startsWith('@/')) base = specifier.slice(2);
  else if (specifier.startsWith('.')) base = posix.normalize(posix.join(posix.dirname(from), specifier));
  else return null;
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (source.has(candidate)) return candidate;
  }
  return null;
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;
const importers = new Map();
for (const [file, text] of source) {
  for (const [, specifier] of text.matchAll(SPECIFIER)) {
    const target = resolveSpecifier(file, specifier);
    if (!target || target === file) continue;
    if (!importers.has(target)) importers.set(target, new Set());
    importers.get(target).add(file);
  }
}

const clientSide = new Set([...source.keys()].filter(hasDirective));
for (let grew = true; grew; ) {
  grew = false;
  for (const file of source.keys()) {
    if (clientSide.has(file)) continue;
    const from = importers.get(file);
    if (from?.size && [...from].every((importer) => clientSide.has(importer))) {
      clientSide.add(file);
      grew = true;
    }
  }
}

const redundant = [...source.keys()]
  .filter(hasDirective)
  .filter((file) => {
    const from = importers.get(file);
    return from?.size > 0 && [...from].every((importer) => clientSide.has(importer));
  })
  .sort();

if (fix) {
  for (const file of redundant) writeFileSync(resolve(src, file), source.get(file).replace(DIRECTIVE, ''));
  console.log(`Removed a redundant 'use client' from ${redundant.length} file(s).`);
  process.exit(0);
}

if (redundant.length) {
  console.error(`❌  ${redundant.length} 'use client' directive(s) mark no boundary — every importer is already client code:\n`);
  for (const file of redundant) console.error(`  - ${file}  (imported by ${[...importers.get(file)].sort().join(', ')})`);
  console.error(`\n  Remove them: node scripts/check-redundant-use-client.mjs --fix`);
  process.exit(1);
}
console.log(`✅  Every 'use client' marks a boundary (${source.size} modules scanned).`);
