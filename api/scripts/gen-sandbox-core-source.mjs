#!/usr/bin/env node
/**
 * Generate (and, with `--check`, verify) the inlinable copy of THE run sandbox.
 *
 * `api/container/sandboxCore.mjs` is the one implementation of a run sandbox's
 * primitives (shell, working tree, post-edit checks), and two transports serve it. The
 * Cloudflare Container imports the file directly. The GitHub Actions runner cannot: it is
 * a single file served over HTTP into a bare checkout with no `npm install`, rendered by
 * a Worker that has no filesystem to read the module from at request time. So the module
 * — with the siblings it imports — is baked into the Worker bundle as a
 * string, and the runner inlines it.
 *
 * That makes the generated file a COPY, so `--check` runs in the api check chain and
 * fails the build the moment it diverges. The fix is never to hand-edit the generated
 * file; it is to run this script.
 *
 *   node scripts/gen-sandbox-core-source.mjs           # write
 *   node scripts/gen-sandbox-core-source.mjs --check   # verify, exit 1 on drift
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(HERE, '..');
const CONTAINER = join(API_ROOT, 'container');
/** In dependency order: the core imports the three before it. */
const MODULES = ['toolOutputPolicy.mjs', 'postEditChecks.mjs', 'sandboxJobs.mjs', 'sandboxCore.mjs'];
const OUT = join(API_ROOT, 'src', 'application', 'runtime', 'generated', 'sandboxCoreSource.ts');

/**
 * One module as the runner needs it: LF line endings (so the artifact does not depend on
 * which machine ran the generator), its import statements removed (the siblings are
 * inlined beside it; the node builtins are collected into {@link builtinImports}), and
 * `export` keywords / export lists stripped — the runner is ONE file, so declarations
 * become top-level bindings there.
 */
function toInline(name, source) {
  const body = source.replace(/\r\n/g, '\n')
    .replace(/^import\s[\s\S]*?\sfrom\s+['"][^'"]+['"];?[ \t]*\n/gm, '')
    .replace(/^export \{[^}]*\};?[ \t]*\n/gm, '')
    .replace(/^export /gm, '');
  return `// ── ${name} ──\n${body.trim()}\n`;
}

/** Every `node:` builtin the modules import, merged per specifier, as import lines. */
function builtinImports(sources) {
  const bySpecifier = new Map();
  for (const source of sources) {
    for (const m of source.replace(/\r\n/g, '\n').matchAll(/^import\s*\{([^}]*)\}\s*from\s*['"](node:[^'"]+)['"];?/gm)) {
      const names = bySpecifier.get(m[2]) ?? new Set();
      for (const n of m[1].split(',').map((s) => s.trim()).filter(Boolean)) names.add(n);
      bySpecifier.set(m[2], names);
    }
  }
  return [...bySpecifier.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([spec, names]) => `import { ${[...names].sort().join(', ')} } from '${spec}';`)
    .join('\n');
}

function render(sources) {
  const imports = builtinImports(sources);
  const inline = MODULES.map((name, i) => toInline(name, sources[i])).join('\n');
  return `/**
 * GENERATED FILE — do not edit by hand.
 *
 * The inlinable form of \`api/container/sandboxCore.mjs\` (with \`toolOutputPolicy.mjs\`,
 * \`postEditChecks.mjs\` and \`sandboxJobs.mjs\`), baked into the Worker bundle so \`githubActionsRunner.ts\`
 * can emit it inside the single-file runner script it serves. \`SANDBOX_CORE_IMPORTS\`
 * is the node builtins the code needs, which the runner places at its top.
 *
 * Regenerate with \`node scripts/gen-sandbox-core-source.mjs\` (from \`api/\`).
 * \`scripts/gen-sandbox-core-source.mjs --check\` runs in the check chain and fails if
 * this file has drifted from the modules it copies.
 */

export const SANDBOX_CORE_IMPORTS = ${JSON.stringify(imports)};

export const SANDBOX_CORE_INLINE = ${JSON.stringify(inline)};
`;
}

const sources = await Promise.all(MODULES.map((m) => readFile(join(CONTAINER, m), 'utf8')));
const expected = render(sources);

if (process.argv.includes('--check')) {
  let actual = null;
  try {
    actual = (await readFile(OUT, 'utf8')).replace(/\r\n/g, '\n');
  } catch {
    actual = null;
  }
  if (actual !== expected) {
    console.error('[gen-sandbox-core-source] src/application/runtime/generated/sandboxCoreSource.ts is out of date.');
    console.error('[gen-sandbox-core-source] The GitHub Actions runner would ship a STALE copy of container/sandboxCore.mjs.');
    console.error('[gen-sandbox-core-source] Fix: cd api && node scripts/gen-sandbox-core-source.mjs');
    process.exit(1);
  }
  console.log('[gen-sandbox-core-source] ok — the runner inlines the current sandbox core.');
  process.exit(0);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, expected);
console.log(`[gen-sandbox-core-source] wrote ${OUT}`);
