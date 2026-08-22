#!/usr/bin/env node
/**
 * Root-layout provider guard.
 *
 * The root layout is the one file where a component can be mounted OUTSIDE a
 * context provider and still look right in review — the provider is three lines
 * above it, the indentation is nearly the same, and nothing in the JSX says which
 * side of the boundary a component needs to be on.
 *
 * `VisitorJourneyTracker` was a sibling of `AuthProvider` rather than a child of
 * it. It calls `useAuth()`, which THROWS when there is no provider above, and it
 * is mounted by the root layout — so it threw during the server render of every
 * route in the app. The build failed on whichever page was prerendered first,
 * which read as one broken page (`/freelancer/timecard`, then `/personas`) rather
 * than as the layout taking all of them down, and cost several CI runs before the
 * shape of it was visible.
 *
 * So: for every provider/hook contract below, no component the root layout renders
 * outside that provider may reach the throwing hook — directly or through anything
 * it imports. Ancestors of the provider are fine by construction: they receive the
 * subtree as `children`, so it never appears in their import graph.
 *
 * A new provider is one entry in `CONTRACTS`, not another branch.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');
const layoutFile = resolve(srcDir, 'app/layout.tsx');

/** Provider → the hooks that throw without it. DATA: a new provider is an entry. */
const CONTRACTS = [
  { provider: 'AuthProvider', hooks: ['useAuth'] },
  { provider: 'ConfirmProvider', hooks: ['useConfirm'] },
  { provider: 'ToastProvider', hooks: ['useToast'] },
];

const failures = [];
const layout = readFileSync(layoutFile, 'utf8');

// --- Module resolution ------------------------------------------------------
const CANDIDATE_SUFFIXES = ['', '.tsx', '.ts', '/index.tsx', '/index.ts'];

function resolveSpecifier(specifier, fromFile) {
  let base;
  if (specifier.startsWith('@/')) base = resolve(srcDir, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null; // a package — outside the app's own graph
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every `from '...'` specifier in a module, resolved to a file inside `src`. */
function importsOf(file) {
  const text = readFileSync(file, 'utf8');
  const found = [];
  for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const resolved = resolveSpecifier(match[1], file);
    if (resolved) found.push(resolved);
  }
  return found;
}

/**
 * Does `file`, or anything it imports, CALL one of `hooks`? Breadth-first over the
 * app's own module graph, so a component that renders an auth-reading child two
 * levels down is caught as surely as one that reads the session itself.
 */
const reachCache = new Map();
function reachesHook(file, hooks) {
  const cacheKey = `${hooks.join('|')}::${file}`;
  const cached = reachCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const callsAHook = hooks.map((hook) => new RegExp(String.raw`\b${hook}\s*\(`));
  const seen = new Set();
  const queue = [file];
  let hit = null;
  while (queue.length > 0 && hit === null) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    const text = readFileSync(current, 'utf8');
    const index = callsAHook.findIndex((pattern) => pattern.test(text));
    if (index !== -1) hit = { hook: hooks[index], file: current };
    else queue.push(...importsOf(current));
  }
  reachCache.set(cacheKey, hit);
  return hit;
}

const inSrc = (file) => relative(srcDir, file).split(sep).join('/');

// --- The layout's own imports: component name -> module ---------------------
const layoutImports = new Map();
for (const match of layout.matchAll(/import\s+(?:type\s+)?([^;]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
  const [, clause, specifier] = match;
  const resolved = resolveSpecifier(specifier, layoutFile);
  if (!resolved) continue;
  for (const name of clause.replace(/[{}]/g, ' ').split(',')) {
    const bound = name.trim().split(/\s+as\s+/).pop()?.trim();
    if (bound && /^[A-Z]/.test(bound)) layoutImports.set(bound, resolved);
  }
}

// --- Check each contract ----------------------------------------------------
for (const { provider, hooks } of CONTRACTS) {
  const open = layout.indexOf(`<${provider}`);
  const close = layout.indexOf(`</${provider}>`);
  if (open === -1 || close === -1) {
    failures.push(`${provider} is not mounted in src/app/layout.tsx — has the root provider tree changed?`);
    continue;
  }
  const outside = layout.slice(0, open) + layout.slice(close);
  const rendered = new Set(
    [...outside.matchAll(/<([A-Z][A-Za-z0-9_]*)/g)].map((match) => match[1]).filter((name) => name !== provider),
  );

  for (const name of rendered) {
    const module = layoutImports.get(name);
    if (!module) continue; // not one of the app's own components
    const hit = reachesHook(module, hooks);
    if (!hit) continue;
    const how = hit.file === module
      ? `calls ${hit.hook}()`
      : `reaches ${hit.hook}() through ${inSrc(hit.file)}`;
    failures.push(
      `<${name} /> is rendered OUTSIDE <${provider}> in src/app/layout.tsx, and it ${how} — `
      + 'which throws when there is no provider above it. The root layout renders on EVERY route, '
      + 'so this fails the server render of the whole app, and the build reports it as one broken '
      + `page. Move <${name} /> inside <${provider}>, or have it read the optional variant.`,
    );
  }
}

if (failures.length > 0) {
  console.error('❌ check:root-layout-providers');
  for (const failure of failures) console.error(`   • ${failure}`);
  process.exit(1);
}
console.log(`✅ check:root-layout-providers — ${CONTRACTS.length} provider contracts hold in the root layout.`);
