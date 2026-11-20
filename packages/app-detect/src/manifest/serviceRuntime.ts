/**
 * The blueprint ↔ manifest service vocabulary, in one place for both directions
 * (`emitManifest`, `manifestToBlueprintOverrides`) and for the web run target, which maps
 * the same blueprint to an `ApplicationSpec`: which runtime and role each blueprint kind is,
 * which runtime a package manager installs on, service roots, and ids the runtime accepts.
 *
 * Roles follow the run target (`frontend/src/lib/runTarget/blueprintToApplicationSpec.ts`
 * `KIND_RUNTIME`): only browser-only frontends are `frontend`; server-rendering frameworks
 * (Next, Remix, SvelteKit, Astro) run server code, so they are backends.
 */

import type { AppService, ServiceKind } from '@builderforce/creation-canvas-contract';

export type ServiceRole = 'frontend' | 'backend';

/** The manifest runtime and default role of each blueprint kind. */
export const KIND_MANIFEST_RUNTIME: Readonly<Record<ServiceKind, { runtime: string; role: ServiceRole }>> = {
  // A Worker runs on workerd; the manifest names the process that starts it (`wrangler dev`, a Node CLI).
  worker: { runtime: 'node', role: 'backend' },
  node: { runtime: 'node', role: 'backend' },
  container: { runtime: 'docker', role: 'backend' },
  spa: { runtime: 'node', role: 'frontend' },
  'vite-react': { runtime: 'node', role: 'frontend' },
  'vite-vue': { runtime: 'node', role: 'frontend' },
  nextjs: { runtime: 'node', role: 'backend' },
  sveltekit: { runtime: 'node', role: 'backend' },
  remix: { runtime: 'node', role: 'backend' },
  astro: { runtime: 'node', role: 'backend' },
  'mobile-expo': { runtime: 'node', role: 'frontend' },
  'mobile-capacitor': { runtime: 'node', role: 'frontend' },
  python: { runtime: 'python', role: 'backend' },
  php: { runtime: 'php', role: 'backend' },
  dotnet: { runtime: 'dotnet', role: 'backend' },
  rust: { runtime: 'rust', role: 'backend' },
  training: { runtime: 'python', role: 'backend' },
};

/** The blueprint kind a manifest runtime reads back as (a Node frontend is an SPA). */
export function kindOfRuntime(runtime: string, role: ServiceRole): ServiceKind | null {
  switch (runtime) {
    case 'node': return role === 'frontend' ? 'spa' : 'node';
    case 'python': return 'python';
    case 'php': return 'php';
    case 'dotnet': return 'dotnet';
    case 'rust': return 'rust';
    case 'docker': return 'container';
    default: return null;
  }
}

/** The runtime a package manager's install runs on (`pip install …` → python). */
export const PACKAGE_MANAGER_RUNTIME: Readonly<Record<AppService['packageManager'], string>> = {
  npm: 'node',
  pnpm: 'node',
  yarn: 'node',
  bun: 'node',
  pip: 'python',
  composer: 'php',
  dotnet: 'dotnet',
  cargo: 'rust',
};

/** The package manager an install line uses, else the runtime's usual one. */
export function packageManagerOf(installLine: string, runtime: string): AppService['packageManager'] {
  const first = installLine.trim().split(/\s+/)[0] ?? '';
  if (/^(npm|pnpm|yarn|bun)$/.test(first)) return first as AppService['packageManager'];
  if (/^pip\d*$/.test(first)) return 'pip';
  if (first === 'composer') return 'composer';
  if (first === 'dotnet') return 'dotnet';
  if (first === 'cargo') return 'cargo';
  return runtime === 'python' ? 'pip' : runtime === 'php' ? 'composer' : runtime === 'dotnet' ? 'dotnet' : runtime === 'rust' ? 'cargo' : 'npm';
}

/** `.` → `/`, `frontend` → `/frontend`, `./api/` → `/api`: a blueprint `rootDir` as a runtime / manifest root. */
export function runtimeRoot(rootDir: string | undefined): string {
  const parts = (rootDir ?? '').replace(/\\/g, '/').split('/').filter((part) => part && part !== '.');
  return `/${parts.join('/')}`;
}

/** `/` → `.`, `/api` → `api`. */
export function blueprintRootDir(root: string | undefined): string {
  const parts = (root ?? '').replace(/\\/g, '/').split('/').filter((part) => part && part !== '.');
  return parts.length > 0 ? parts.join('/') : '.';
}

/** An id the runtime accepts (`^[A-Za-z][A-Za-z0-9_-]*$`), unique among `taken`. */
export function safeId(raw: string, taken: Set<string>): string {
  const base = raw.replace(/^@[^/]+\//, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[^A-Za-z]+/, '').replace(/-+$/, '') || 'service';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}
