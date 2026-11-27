import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { linkedTargets, readManifest } from '../../scripts/linkedPackages.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const npmPackages = [
  { dir: 'browser-sdk', package: '@seanhogg/builderforce-quality' },
  { dir: 'sdk', package: '@seanhogg/builderforce-sdk' },
  { dir: 'studio', package: '@seanhogg/builderforce-studio' },
  { dir: 'studio-embedded', package: '@seanhogg/builderforce-studio-embedded', 'builds-first': 'studio' },
  { dir: 'voice', package: '@seanhogg/builderforce-voice' },
  { dir: 'replay-sdk', package: '@seanhogg/builderforce-replay' },
  {
    dir: 'packages/builderforce-mcp',
    package: '@seanhogg/builderforce-mcp',
    'pack-with-pnpm': true,
    'stage-on-oidc-denial': true,
    sources: ['packages/secret-redaction', 'packages/tool-output-policy'],
  },
];

function dependencyDirs(roots) {
  const visited = new Set();
  function visit(dir) {
    if (visited.has(dir)) return;
    visited.add(dir);
    const manifest = readManifest(dir);
    if (manifest) linkedTargets(dir, manifest).forEach(visit);
  }
  roots.forEach((dir) => visit(path.resolve(root, dir)));
  return [...visited].map((dir) => path.relative(root, dir).split(path.sep).join('/'));
}

/** True when any of `files` is one of `prefixes` or lies under one (repo-relative POSIX paths). */
export function pathTouches(files, prefixes) {
  return files.some((file) => prefixes.some((name) => file === name || file.startsWith(`${name}/`)));
}

export function affectedBuilds(files, full = false) {
  const touches = (...paths) => full || pathTouches(files, paths);
  const sharedBuild = touches('.github', 'scripts', '.nvmrc', '.dockerignore');
  // These consumers compile source aliases and enforce the shared package registry.
  const sharedSource = touches('packages');
  const api = sharedBuild || sharedSource || touches('api', 'Dockerfile.api', 'infra', 'worker');
  const frontend = sharedBuild || sharedSource || touches('Dockerfile.frontend', ...dependencyDirs(['frontend']));
  const distribution = sharedBuild || touches('distribution', 'server.json');
  const extension = frontend || distribution || touches(...dependencyDirs(['clients/vscode']));
  const agent = sharedBuild || sharedSource || touches(...dependencyDirs(['agent-runtime']), 'apps/shared/BuilderforceKit/Tools/CanvasA2UI');
  const webdit = sharedBuild || touches('webdit/torch');
  const cdn = sharedBuild || touches('replay-sdk', 'infra/cdn');
  return {
    api,
    frontend,
    'verify-frontend': frontend || touches('clients/chrome'),
    extension,
    agent,
    kernel: sharedBuild || sharedSource,
    webdit,
    distribution,
    mcp: api || distribution,
    cdn,
    dotnet: sharedBuild || touches('frontend/package.json', 'frontend/pnpm-lock.yaml', 'infra/cdn'),
    action: sharedBuild || distribution || touches('actions'),
    help: sharedBuild || touches('docs-site'),
    npm: {
      include: npmPackages.filter(({ dir, sources = [] }) => sharedBuild || touches(...dependencyDirs([dir]), ...sources)),
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2];
  // Optional end of the range (default HEAD): plan-base.sh asks "did this component change between two
  // commits" with the same path rules, instead of keeping a second copy of them.
  const head = process.argv[3] || 'HEAD';
  // --no-renames keeps both sides of a move in the affected set.
  const files = base ? execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, head], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  }).split('\0').filter(Boolean) : [];
  const plan = affectedBuilds(files, !base || process.env.FULL_BUILD === 'true');
  const output = { ...plan, 'has-npm': plan.npm.include.length > 0 };
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(output).map(([key, value]) => `${key}=${JSON.stringify(value)}\n`).join(''));
  }
  console.log(JSON.stringify(output, null, 2));
}
