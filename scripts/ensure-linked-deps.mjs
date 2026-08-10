#!/usr/bin/env node
/**
 * Install the dependencies of every `link:`ed local package a consumer depends on.
 *
 * The repo is a set of SEPARATELY installed packages (own `package.json` + own
 * `pnpm-lock.yaml`) that reference each other with `link:../..` specifiers — it is
 * deliberately NOT a pnpm workspace. pnpm honours a `link:` by symlinking the
 * target directory and NOTHING else: the linked package's OWN dependencies are
 * never installed by the consumer's `pnpm install`. So on a clean checkout (CI),
 * `packages/brain-ui/node_modules` does not exist, and every bare import inside
 * `packages/brain-ui/dist/*` — `react`, `@seanhogg/builderforce-brain-embedded` —
 * is unresolvable from that directory.
 *
 * That failure is SILENT where it hurts most. `skipLibCheck: true` swallows the
 * unresolved import inside the shipped `.d.ts`, so a type that extends a type
 * from the unresolved package quietly loses its members and the consumer's own
 * source starts failing with nonsense ("Property 'paidCostDetail' does not exist
 * on type 'PromptOptionsLabels'", "Parameter 'e' implicitly has an 'any' type") —
 * errors that reproduce ONLY on a machine where the linked package happens to
 * have no `node_modules`, which is to say: only in CI.
 *
 * Wired as `postinstall` in every package that links local packages, so a fresh
 * `pnpm install` leaves the same on-disk shape a developer's machine has. Failures
 * are warnings, never errors — a linked package that cannot install must degrade
 * the build the way it does today, not break an install that used to succeed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const LINK_PREFIXES = ['link:', 'file:'];

function readManifest(dir) {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Local packages this manifest links, as absolute directories. */
function linkedTargets(dir, manifest) {
  const specs = { ...manifest.dependencies, ...manifest.devDependencies };
  return Object.values(specs)
    .filter((spec) => typeof spec === 'string' && LINK_PREFIXES.some((p) => spec.startsWith(p)))
    .map((spec) => spec.slice(spec.indexOf(':') + 1))
    .map((target) => (isAbsolute(target) ? target : resolve(dir, target)))
    .filter((target) => existsSync(join(target, 'package.json')));
}

/**
 * True when every declared dependency already has a directory under the package's
 * own `node_modules`. Dev dependencies count: a package's published `.d.ts` refers
 * to types (`@types/react`) that live there, and consumers type-check against it.
 */
function depsPresent(dir, manifest) {
  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  return names.every((name) => existsSync(join(dir, 'node_modules', name)));
}

/**
 * Packages already handled, shared with the nested installs this script triggers:
 * each linked package runs its OWN `postinstall`, so the visited set has to survive
 * across processes or a dependency cycle would recurse forever.
 */
const VISITED_ENV = 'BF_ENSURE_LINKED_DEPS';
const visited = new Set((process.env[VISITED_ENV] ?? '').split('|').filter(Boolean));

function install(dir) {
  const frozen = existsSync(join(dir, 'pnpm-lock.yaml'));
  const env = { ...process.env, [VISITED_ENV]: [...visited].join('|') };
  const args = frozen ? ['install', '--frozen-lockfile'] : ['install'];
  const run = (a) => spawnSync('pnpm', a, { cwd: dir, stdio: 'inherit', shell: true, env }).status === 0;
  return run(args) || (frozen && run(['install']));
}

const installed = [];
const failed = [];

function walk(dir) {
  let key;
  try {
    key = realpathSync(dir);
  } catch {
    return;
  }
  if (visited.has(key)) return;
  visited.add(key);

  const manifest = readManifest(dir);
  if (!manifest) return;

  if (!depsPresent(dir, manifest)) {
    console.log(`[ensure-linked-deps] installing dependencies of ${manifest.name ?? dir}`);
    if (install(dir)) installed.push(manifest.name ?? dir);
    else failed.push(manifest.name ?? dir);
  }

  // Recurse AFTER installing: a link target only appears once its parent installed.
  for (const target of linkedTargets(dir, manifest)) walk(target);
}

// No argument: cwd is the package pnpm/npm just installed (the `postinstall`
// shape), so only its link targets are missing. An explicit directory is a
// caller saying "this package must be installed before I can build" — the canvas
// bundle compiles `frontend/` source, so its own bare imports have to resolve —
// and that directory is walked like any other target: installed if its declared
// dependencies are not on disk, then recursed into. Already installed is the
// common case and costs one `existsSync` per dependency.
const explicit = process.argv.slice(2).map((dir) => resolve(dir));
const root = explicit[0] ?? process.cwd();
const rootManifest = readManifest(root);
if (!rootManifest) {
  console.warn(`[ensure-linked-deps] no package.json at ${root} — nothing to do.`);
} else {
  if (explicit.length) {
    for (const dir of explicit) walk(dir);
  } else {
    // The consumer itself was just installed; only its link targets need walking.
    visited.add(realpathSync(root));
    for (const target of linkedTargets(root, rootManifest)) walk(target);
  }

  if (installed.length) console.log(`[ensure-linked-deps] installed: ${installed.join(', ')}`);
  if (failed.length) {
    console.warn(`::warning::[ensure-linked-deps] could not install: ${failed.join(', ')} — type-checking against these packages may degrade.`);
  }
  if (!installed.length && !failed.length) console.log('[ensure-linked-deps] linked packages already installed.');
}
