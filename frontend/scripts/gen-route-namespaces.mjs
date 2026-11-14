/**
 * Generate the route→namespace map for chunked catalog loading.
 *
 * WHY this exists: `src/i18n/routeNamespaces.ts` needs to map each top-level
 * App-Router segment to the message namespaces that segment's pages read, so
 * `catalog.ts` can fetch ONLY those namespaces instead of the whole ~1.2 MB
 * catalog. Hand-writing that map against 358 real namespaces produced 13 bogus
 * names and referenced ~9% of the real ones — it doesn't scale and sends users
 * to 404ing chunk URLs. So this GENERATES the map from actual usage.
 *
 * How: for each top-level segment under `src/app/`, it finds the route
 * boundaries (`page|route|layout|loading|error|not-found|default`), then walks
 * the TRANSITIVE import closure of each boundary (resolving both relative paths
 * and the `@/…` alias to `src/`), collecting every literal namespace passed to
 * `useTranslations('ns')` / `getTranslations('ns')`. It emits
 * `src/i18n/routeNamespaces.generated.ts` exporting the same `namespacesForPath()`
 * API the hand-written version had — so `catalog.ts` and the tests don't change.
 *
 * Correctness is preserved regardless of accuracy: a namespace a route's map
 * omits is fetched ON DEMAND when a component asks for it (`loadNamespace`, via
 * next-intl's `onError`). A coarse map is a perf miss, never a wrong-language or
 * missing-label bug. This generator just makes the map tight enough to matter.
 *
 * Run from `prebuild` + `dev`, before `split-message-catalogs.mjs`. Output is
 * committed (unlike the chunk assets): the map is derived from SOURCE, like a
 * lockfile, so a route works even if generation was skipped. Regenerate when
 * namespaces move between routes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const APP = path.join(SRC, 'app');
const OUT = path.join(SRC, 'i18n', 'routeNamespaces.generated.ts');

const HEADING = 'The ONE place a message catalog is loaded';
const catalogProbe = path.join(SRC, 'i18n', 'catalog.ts');
const catalogFile = fs.existsSync(catalogProbe) ? fs.readFileSync(catalogProbe, 'utf8') : '';
if (!catalogFile.includes(HEADING)) {
  console.error('[i18n:route-map] refusing to run: src/i18n/catalog.ts heading not found.');
  process.exit(1);
}

/** Namespaces every route reads: chrome (nav/footer), shared buckets, errors. */
const SHARED = ['common', 'components', 'notFound'];
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__', '__mocks__']);
const BOUNDARY = /^(page|route|layout|loading|error|not-found|default)\.tsx?$/;
const RESOLVE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs'];

/**
 * The real top-level namespaces, from the source of truth. Every namespace the
 * map emits MUST be one of these — the runtime fetches `chunks/<locale>/<ns>.json`
 * per name, and a name that isn't a real namespace is a guaranteed 404. `errors`
 * was burned once: it sat in SHARED as a guessed chrome bucket and every route's
 * chunk list carried a dead entry until this validation existed.
 */
const enCatalog = JSON.parse(
  fs.readFileSync(path.join(SRC, 'i18n', 'messages', 'en.json'), 'utf8'),
);
const realNamespaces = new Set(
  Object.keys(enCatalog).filter(
    (k) => enCatalog[k] && typeof enCatalog[k] === 'object' && !Array.isArray(enCatalog[k]),
  ),
);

/** `useTranslations('ns')` / `getTranslations('ns')` with a literal namespace. */
const NS_CALL = /(?:useTranslations|getTranslations)\(\s*'([a-zA-Z0-9_]+)'/g;
/** `from '…'` and side-effect `import '…'` specifiers. */
const IMPORT_SPEC = /(?:from\s+|import\s*\(\s*)'([^']+)'/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

/** Resolve an import specifier to a file on disk (relative + `@/` → src/), or null. */
function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else if (spec.startsWith('@/')) {
    base = path.join(SRC, spec.slice(2));
  } else {
    return null; // package — not ours
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    if (fs.existsSync(base + ext) && !base.endsWith('.test')) return base + ext;
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const index = path.join(base, `index${ext}`);
    if (fs.existsSync(index)) return index;
  }
  return null;
}

/** Cache file text + namespaces so the transitive walk parses each file once. */
const allFiles = walk(SRC);
const fileText = new Map();
const fileNamespaces = new Map();
for (const f of allFiles) {
  const text = fs.readFileSync(f, 'utf8');
  fileText.set(f, text);
  const ns = new Set();
  for (const m of text.matchAll(NS_CALL)) ns.add(m[1]);
  fileNamespaces.set(f, ns);
}

/** Transitive import closure of `entry`, restricted to files under `src/`. */
function importClosure(entry) {
  const seen = new Set([entry]);
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    const text = fileText.get(file) ?? '';
    for (const m of text.matchAll(IMPORT_SPEC)) {
      const resolved = resolveImport(m[1], file);
      if (resolved && !seen.has(resolved) && resolved.startsWith(SRC)) {
        seen.add(resolved);
        stack.push(resolved);
      }
    }
  }
  return seen;
}

function main() {
  /** segment -> Set<namespace> */
  const segmentMap = new Map();
  const segments = fs.readdirSync(APP, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('(')) // skip route groups
    .map((e) => e.name);

  for (const segment of segments) {
    const dir = path.join(APP, segment);
    const namespaces = new Set(SHARED);
    for (const f of walk(dir)) {
      if (!BOUNDARY.test(path.basename(f))) continue;
      for (const dep of importClosure(f)) {
        for (const ns of fileNamespaces.get(dep) ?? []) namespaces.add(ns);
      }
    }
    // Only emit an explicit entry when it adds something beyond SHARED, else the
    // catch-all handles it — keeps the generated file small. Names are filtered
    // to REAL namespaces: a useTranslations('x') for a key that isn't a top-level
    // namespace would otherwise ship a dead chunk URL in every route's list.
    const extra = [...namespaces]
      .filter((n) => !SHARED.includes(n) && realNamespaces.has(n))
      .sort();
    if (extra.length) segmentMap.set(segment, extra);
  }

  const lines = [];
  lines.push('/** GENERATED by scripts/gen-route-namespaces.mjs — do not edit by hand. */');
  lines.push('const SHARED: readonly string[] = ' + JSON.stringify(SHARED) + ';');
  lines.push('');
  lines.push('const SEGMENT_NAMESPACES: Record<string, readonly string[]> = {');
  for (const [segment, full] of [...segmentMap.entries()].sort()) {
    lines.push(`  ${JSON.stringify(segment)}: ${JSON.stringify(full)},`);
  }
  lines.push('};');
  lines.push('');
  lines.push('export function namespacesForPath(pathname: string): string[] {');
  lines.push("  const segment = pathname.split('/').filter(Boolean)[0];");
  lines.push('  if (!segment) return [...SHARED];');
  lines.push('  const hit = SEGMENT_NAMESPACES[segment];');
  lines.push('  return hit ? [...hit] : [...SHARED];');
  lines.push('}');
  lines.push('');

  const out = lines.join('\n');
  if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== out) {
    fs.writeFileSync(OUT, out, 'utf8');
  }
  console.log(`[i18n:route-map] ${segmentMap.size} segment(s) → routeNamespaces.generated.ts`);
}

main();
