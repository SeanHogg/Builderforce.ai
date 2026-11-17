#!/usr/bin/env node
/**
 * check:browser-dist — a package that ships into BROWSER bundles has no Node builtin in its ESM dist.
 *
 *   node ../scripts/check-browser-dist.mjs dist
 *
 * `@seanhogg/builderforce-brain-embedded` is bundled by the frontend's `next build` and the VS Code
 * webview's Vite build, both through the `import` condition (`dist/*.mjs`). A static
 * `import nodeModule from "module"` in its source (`handOffParallelism.ts`, 2026-11-13) built and
 * tested green inside the package, then failed CI's "Build frontend" with
 * `Module not found: Can't resolve 'module'`. Node-only capabilities are the HOST's, injected
 * through the run request; this check fails the package's own build the moment one leaks back in.
 *
 * Only `.mjs` is read: the CJS output is the Node (`require`) condition and may legitimately name a
 * builtin. The scan itself is `staticBuiltinImports` in `lib/distImports.mjs`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { staticBuiltinImports } from './lib/distImports.mjs';

const distArg = process.argv[2];
if (!distArg) {
  process.stderr.write('usage: check-browser-dist.mjs <dist-dir>\n');
  process.exit(2);
}
const dist = resolve(process.cwd(), distArg);
if (!existsSync(dist)) {
  process.stderr.write(`check-browser-dist: ${dist} does not exist — build first\n`);
  process.exit(2);
}

const failures = [];
for (const name of readdirSync(dist).filter((n) => n.endsWith('.mjs')).sort()) {
  const builtins = staticBuiltinImports(readFileSync(join(dist, name), 'utf8'));
  if (builtins.length > 0) failures.push(`  ${name}: ${builtins.join(', ')}`);
}

if (failures.length > 0) {
  process.stderr.write(
    `check-browser-dist: ${failures.length} ESM file(s) in ${distArg} import a Node builtin, which a browser bundle cannot resolve:\n` +
      `${failures.join('\n')}\n` +
      'Inject the Node-only capability from the host (e.g. a probe on the run request) instead of importing it.\n',
  );
  process.exit(1);
}
process.stdout.write(`check-browser-dist: ${distArg} — no Node builtin in the ESM output\n`);
