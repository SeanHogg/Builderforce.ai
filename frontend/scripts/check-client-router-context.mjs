#!/usr/bin/env node
/**
 * One copy of each context in the browser chunks the App Router can load.
 *
 * Next emits a separate Pages Router runtime for its fallback pages. Its main
 * entry legitimately initializes its own contexts. Exclude only the legacy
 * bootstrap and page entries confirmed by the manifests. Keep shared chunks and
 * unlisted lazy chunks in the scan so a second App Router instance still fails CI.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const buildDir = resolve(root, '.next');
const chunksDir = resolve(buildDir, 'static/chunks');

if (!existsSync(chunksDir)) {
  console.error(`check-client-router-context: ${relative(root, chunksDir)} not found — run \`next build\` first.`);
  process.exit(1);
}

const build = JSON.parse(readFileSync(join(buildDir, 'build-manifest.json'), 'utf8'));
const app = JSON.parse(readFileSync(join(buildDir, 'app-build-manifest.json'), 'utf8'));
const appFiles = new Set([...build.rootMainFiles, ...Object.values(app.pages).flat()]);
const pagesOnly = new Set(Object.values(build.pages).flat().filter((file) =>
  !appFiles.has(file) && /^static\/chunks\/(?:main-|pages\/)/.test(file),
));

const signatures = {
  'app-router-context': /AppRouterContext:function\(\)\{[^}]*\},GlobalLayoutRouterContext:function\(\)\{[^}]*\},LayoutRouterContext:function\(\)\{[^}]*\},MissingSlotContext:function\(\)\{[^}]*\},TemplateContext:function\(\)\{/g,
  'hooks-client-context': /PathParamsContext:function\(\)\{[^}]*\},PathnameContext:function\(\)\{[^}]*\},SearchParamsContext:function\(\)\{/g,
};

function* jsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* jsFiles(full);
    else if (name.endsWith('.js')) yield full;
  }
}

const copies = new Map(Object.keys(signatures).map((name) => [name, []]));
for (const file of jsFiles(chunksDir)) {
  if (pagesOnly.has(relative(buildDir, file).split(sep).join('/'))) continue;
  const source = readFileSync(file, 'utf8');
  for (const [name, signature] of Object.entries(signatures)) {
    for (const match of source.matchAll(signature)) {
      copies.get(name).push(`${relative(root, file)} @ ${match.index}`);
    }
  }
}

for (const [name, matches] of copies) {
  if (matches.length === 1) {
    console.log(`check-client-router-context: one ${name} module in the browser bundle.`);
    continue;
  }
  console.error(`check-client-router-context: expected one ${name} module, found ${matches.length}.`);
  for (const copy of matches) console.error(`  ${copy}`);
  console.error(matches.length
    ? 'Next router providers and hooks must share the same context. See CanonicalPackagePathsPlugin in next.config.js.'
    : 'Check the exported module signature for this Next version.');
  process.exitCode = 1;
}
