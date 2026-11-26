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

export function affectedBuilds(files, full = false) {
  const touches = (...paths) => full || files.some((file) => paths.some((name) => file === name || file.startsWith(`${name}/`)));
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
    npm: { include: npmPackages.filter(({ dir }) => sharedBuild || touches(...dependencyDirs([dir]))) },
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
