#!/usr/bin/env node
/**
 * Declared-dependency guard.
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
 * Specifiers come from TypeScript's own preprocessor rather than a regex: this
 * codebase is full of source code INSIDE strings (scaffold templates, generated
 * Playwright specs, model prompts), and only a real scanner tells an import
 * statement apart from a template literal that contains one.
 *
 * Run via `npm run check:declared-deps`; wired into `npm test`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import ts from 'typescript';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const srcDir = resolve(here, '../src');
const scriptsDir = resolve(here, '../scripts');
const pkgPath = resolve(here, '../package.json');
const tsconfigPath = resolve(here, '../tsconfig.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
]);

/**
 * tsconfig `paths` are read rather than hardcoded so the guard cannot drift
 * from the aliases the compiler actually honours (`@/*`, the canvas contract).
 */
const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const aliases = Object.keys(tsconfig.compilerOptions?.paths ?? {}).map((key) =>
  key.endsWith('/*') ? key.slice(0, -1) : key,
);

const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/**
 * Specifiers supplied by the framework/bundler rather than by a package.json
 * entry. Every entry needs a REASON.
 */
const ALLOWED = new Map([
  ['server-only', 'A Next.js build-time poison-pill module, resolved by the bundler; it has no runtime surface to declare.'],
  ['client-only', 'A Next.js build-time poison-pill module, resolved by the bundler; it has no runtime surface to declare.'],
]);

/** Bare specifier -> the package that must be declared. */
function packageRoot(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const violations = [];

const roots = [
  { dir: srcDir, label: 'src' },
  { dir: scriptsDir, label: 'scripts' },
];

for (const { dir: root, label } of roots) for (const file of collect(root)) {
  const rel = `${label}/${relative(root, file).split('\\').join('/')}`;
  const text = readFileSync(file, 'utf8');
  // (text, readImportFiles, detectJavaScriptImports) — the third argument picks
  // up `require(…)` and bare dynamic `import(…)` alongside static imports.
  const { importedFiles } = ts.preProcessFile(text, true, true);

  for (const imported of importedFiles) {
    const specifier = imported.fileName;
    if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
    if (aliases.some((alias) => specifier === alias || specifier.startsWith(alias))) continue;
    if (builtins.has(specifier) || builtins.has(packageRoot(specifier))) continue;
    if (ALLOWED.has(specifier) || ALLOWED.has(packageRoot(specifier))) continue;
    if (declared.has(packageRoot(specifier))) continue;

    const line = text.slice(0, imported.pos).split('\n').length;
    violations.push({ rel, line, specifier });
  }
}

if (violations.length > 0) {
  const missing = [...new Set(violations.map((v) => packageRoot(v.specifier)))];
  console.error(`❌  Undeclared (phantom) dependencies imported from src/ or scripts/ (${violations.length} site(s)):\n`);
  for (const v of violations) console.error(`  - ${v.rel}:${v.line}  '${v.specifier}'`);
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
