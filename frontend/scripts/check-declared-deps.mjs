#!/usr/bin/env node
/**
 * Declared-dependency guard for the frontend app.
 *
 * Every bare module specifier imported from `src/**` OR `scripts/**` must be a
 * package this app DECLARES in its own package.json — not one it merely inherits
 * through somebody else's dependency tree.
 *
 * This is not hypothetical. `lib/markdownPipeline.ts` imported the type
 * `PluggableList` from `unified`. `unified` is a transitive dependency of
 * react-markdown/remark, never a declared one, so it happened to resolve in the
 * flat local node_modules and did NOT resolve under pnpm's strict layout in CI.
 * Nothing caught it until `next build` failed four and a half minutes into a
 * production deploy with "Cannot find module 'unified' or its corresponding
 * type declarations".
 *
 * A phantom dependency is a build that works on one machine and not another,
 * and a type-only one is worse: it costs nothing at runtime, so it survives
 * every test and dies only at the deploy.
 *
 * `scripts/**` is in scope because those files RUN IN THE BUILD, and the same
 * failure arrived through them: `gen-blog-og.mjs` landed with `import sharp from
 * 'sharp'` while the frontend declared sharp only as a pnpm OVERRIDE — a version
 * pin for whoever else depends on it, never an instruction to install it here. It
 * resolved locally off a hoisted copy and died in `prebuild` on the deploy, which
 * is precisely the class of failure this guard already existed to prevent. A guard
 * that watches one of the two directories the build reads is a guard with a blind
 * spot the build can fall into.
 *
 * THE SCAN AND THE COMPARISON ARE SHARED. Both live in `scripts/lib/` and are
 * used by `scripts/check-source-package-graph.mjs` too — the same rule applied to
 * the source-only packages under `packages/`. This file used to hold its own copy
 * of both, built on `ts.preProcessFile`, and that copy had a bug the shared one
 * does not: `preProcessFile` is a LEXICAL scanner, so an import statement inside a
 * template literal counts. This codebase is full of source code in strings —
 * scaffold templates, generated Playwright specs, model prompts — and the shared
 * scanner parses instead, so only real imports are reported.
 *
 * Run via `npm run check:declared-deps`; wired into `npm test`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript, packageRoot, scanBareImports } from '../../scripts/lib/moduleImports.mjs';
import { aliasPrefixes, declaredNames, undeclaredImports } from '../../scripts/lib/declaredDependencies.mjs';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const frontendDir = resolve(here, '..');
const repoRoot = resolve(frontendDir, '..');

const pkg = JSON.parse(readFileSync(resolve(frontendDir, 'package.json'), 'utf8'));
const declared = declaredNames(pkg);

/**
 * tsconfig `paths` are read rather than hardcoded so the guard cannot drift
 * from the aliases the compiler actually honours (`@/*`, the canvas contract).
 */
const tsconfig = JSON.parse(readFileSync(resolve(frontendDir, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const aliases = aliasPrefixes(tsconfig.compilerOptions?.paths ?? {});

/**
 * Specifiers supplied by the framework/bundler rather than by a package.json
 * entry. Every entry needs a REASON.
 */
const ALLOWED = new Map([
  ['server-only', 'A Next.js build-time poison-pill module, resolved by the bundler; it has no runtime surface to declare.'],
  ['client-only', 'A Next.js build-time poison-pill module, resolved by the bundler; it has no runtime surface to declare.'],
]);

const ts = loadTypeScript(repoRoot);
const imports = await scanBareImports({
  ts,
  repoRoot: frontendDir,
  dirs: [resolve(frontendDir, 'src'), resolve(frontendDir, 'scripts')],
});

const violations = undeclaredImports({ imports, declared, aliases, allowed: ALLOWED });

if (violations.length > 0) {
  const missing = [...new Set(violations.map((v) => packageRoot(v.specifier)))];
  console.error(`❌  Undeclared (phantom) dependencies imported from src/ or scripts/ (${violations.length} site(s)):\n`);
  for (const v of violations) console.error(`  - ${v.relative}:${v.line}  '${v.specifier}'`);
  console.error(
    `\n   Missing from frontend/package.json: ${missing.join(', ')}` +
      '\n   These resolve locally only because a dependency of a dependency hoisted' +
      "\n   them. pnpm's strict node_modules in CI does not, so the production build" +
      '\n   fails. Either declare the package, or derive what you need from one that' +
      "\n   IS declared (e.g. the plugin-list type off react-markdown's own Options" +
      "\n   instead of PluggableList from 'unified')." +
      '\n   A bundler/framework-supplied specifier goes in ALLOWED in' +
      '\n   scripts/check-declared-deps.mjs WITH a reason.\n',
  );
  process.exit(1);
}

console.log('✅  Declared-dependency check passed — every bare import in src/ and scripts/ resolves to a declared package.');
