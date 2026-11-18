/**
 * `AppBlueprint` → `ApplicationSpec` (PRD 31 §W9 phase 5) — the ONE mapping from what
 * the app IS (W2) to what the browser runtime runs. Pure: no runtime, no network.
 *
 * - Each blueprint service becomes an `application` service on the runtime its `kind`
 *   names (`KIND_RUNTIME`), with its dev command, dev port (declared, else the kind's
 *   default — `serviceDevPort`), `dependsOn`, readiness and restart policy.
 * - A Postgres-compatible database (`postgres`, `neon`) becomes a persistent PGlite
 *   `database` service with the reserved id `db`; any other engine, or a blueprint that
 *   pins another provider (`neon-branch`), is mapped as-is so PGlite declines it by name.
 * - `migrationCommand` / `seedCommand` become one-off (`exit-zero`) services that every
 *   backend depends on, so the API starts only on a migrated, seeded database.
 * - Each service root with an install command gets one one-off install service first.
 * - Only browser-only frontends (an SPA, Vite) are `frontend`: they never depend on the
 *   database, so they never receive `DATABASE_URL`. SSR frameworks (Next, Remix,
 *   SvelteKit, Astro) run server code, so they are backends and do.
 */
import { serviceDevPort, type AppBlueprint, type AppService, type ServiceKind } from '@builderforce/creation-canvas-contract';
import type { ApplicationSpec, ReadinessSpec, ServiceRole, ServiceSpec } from '@seanhogg/builderforce-webcontainers/app';

/** Which runtime provider runs each blueprint kind, and whether its code runs only in the browser. */
export const KIND_RUNTIME: Readonly<Record<ServiceKind, { runtime: string; role: ServiceRole }>> = {
  // A Worker runs on workerd (`wrangler dev` / Miniflare): declined by kind, whatever its command.
  worker: { runtime: 'workerd', role: 'backend' },
  node: { runtime: 'node', role: 'backend' },
  container: { runtime: 'docker', role: 'backend' },
  spa: { runtime: 'node', role: 'frontend' },
  'vite-react': { runtime: 'node', role: 'frontend' },
  'vite-vue': { runtime: 'node', role: 'frontend' },
  // Server-rendering frameworks run server code (loaders, actions, API routes).
  nextjs: { runtime: 'node', role: 'backend' },
  sveltekit: { runtime: 'node', role: 'backend' },
  remix: { runtime: 'node', role: 'backend' },
  astro: { runtime: 'node', role: 'backend' },
  'mobile-expo': { runtime: 'expo', role: 'frontend' },
  'mobile-capacitor': { runtime: 'capacitor', role: 'frontend' },
};

/** Database engines PGlite stands in for, mapped to the engine name the runtime takes. */
const POSTGRES_ENGINES: Readonly<Record<string, string>> = { postgres: 'postgres', neon: 'postgres' };

/** The port the browser database listens on (the app sees it in `DATABASE_URL`). */
export const BROWSER_DATABASE_PORT = 5432;

/** Ids the database and its steps always get, so a service can never take them. */
export const RESERVED_IDS = { db: 'db', migrate: 'db-migrate', seed: 'db-seed' } as const;

/** Commands that run as they are; any other first word is a package binary, run through `npx`. */
const RUNNERS = new Set(['node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'bfsh']);

/** Shell operators (incl. a bare `&`), substitutions and redirects need the shell (`bfsh -c`). */
const SHELL_SYNTAX = /[&|;<>`$]/;
/** A leading `NAME=value` environment assignment needs the shell too. */
const ENV_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Split a command line into words, honouring single and double quotes. */
export function commandWords(line: string): string[] {
  const words: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of line.matchAll(pattern)) words.push(match[1] ?? match[2] ?? match[3] ?? '');
  return words;
}

/** `npm run dev` → `npm ['run','dev']`; `vite --port 5173` → `npx ['vite',…]`; `a && b` → `bfsh ['-c','a && b']`. */
export function commandOf(line: string): { command: string; args: string[] } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (SHELL_SYNTAX.test(trimmed) || ENV_PREFIX.test(trimmed)) return { command: 'bfsh', args: ['-c', trimmed] };
  const [first, ...rest] = commandWords(trimmed);
  if (!first) return null;
  return RUNNERS.has(first) ? { command: first, args: rest } : { command: 'npx', args: [first, ...rest] };
}

/**
 * The words a runtime provider should judge a service by. A shell command's words are
 * inside its `-c` string, so a provider that declines by command name (`wrangler`,
 * `docker`) is shown them as arguments — the judgement, not the spawn.
 */
export function acceptanceProbe(service: ServiceSpec): ServiceSpec {
  if (service.command !== 'bfsh' || service.args?.[0] !== '-c') return service;
  return { ...service, args: commandWords(service.args[1] ?? '') };
}

/** `.` → `/`, `frontend` → `/frontend`, `./api/` → `/api`. */
export function runtimeRoot(rootDir: string | undefined): string {
  const parts = (rootDir ?? '').replace(/\\/g, '/').split('/').filter((part) => part && part !== '.');
  return `/${parts.join('/')}`;
}

/** A service id the runtime accepts (`^[A-Za-z][A-Za-z0-9_-]*$`), unique among `taken`. */
function safeId(raw: string, taken: Set<string>): string {
  const base = raw.replace(/^@[^/]+\//, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[^A-Za-z]+/, '').replace(/-+$/, '') || 'service';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function readinessFor(service: AppService, port: number | undefined): ReadinessSpec {
  if (service.readiness) return service.readiness;
  return port !== undefined ? { kind: 'port' } : { kind: 'exit-zero' };
}

/** A one-off step (install, migrate, seed): runs to exit 0, never restarts on its own. */
function oneOff(id: string, line: string, root: string, dependsOn: string[]): ServiceSpec | null {
  const command = commandOf(line);
  if (!command) return null;
  return {
    id, type: 'application', runtime: 'node', root, ...command,
    readiness: { kind: 'exit-zero' }, restartPolicy: 'never',
    ...(dependsOn.length > 0 ? { dependsOn } : {}),
  };
}

const unique = (ids: string[]): string[] => [...new Set(ids)];

export function roleOfService(service: AppService): ServiceRole {
  return service.role ?? KIND_RUNTIME[service.kind]?.role ?? 'backend';
}

export function blueprintToApplicationSpec(blueprint: AppBlueprint): ApplicationSpec {
  const taken = new Set<string>(Object.values(RESERVED_IDS));
  const ids = new Map(blueprint.services.map((service) => [service.id, safeId(service.id, taken)]));
  const backends = blueprint.services.filter((service) => roleOfService(service) === 'backend');

  // One install per service root, before anything in that root runs.
  const installs = new Map<string, ServiceSpec>();
  for (const service of blueprint.services) {
    const root = runtimeRoot(service.rootDir);
    if (installs.has(root) || !service.installCommand?.trim()) continue;
    const step = oneOff(safeId(`${ids.get(service.id)}-install`, taken), service.installCommand, root, []);
    if (step) installs.set(root, step);
  }
  const installOf = (root: string): string[] => (installs.has(root) ? [installs.get(root)!.id] : []);

  // The database, then its migration and seed — run where the first backend lives.
  const tasks: ServiceSpec[] = [];
  const databaseDeps: string[] = [];
  const database = blueprint.database;
  if (database) {
    tasks.push({
      id: RESERVED_IDS.db, type: 'database', runtime: 'pglite', port: BROWSER_DATABASE_PORT, readiness: { kind: 'query' },
      database: {
        engine: POSTGRES_ENGINES[database.engine] ?? database.engine,
        // A blueprint that pins its host (a Neon branch) is honoured — PGlite then declines it.
        provider: database.provider ?? 'pglite',
        persistent: true,
      },
    });
    databaseDeps.push(RESERVED_IDS.db);
    const root = runtimeRoot(backends[0]?.rootDir);
    const migrate = oneOff(RESERVED_IDS.migrate, database.migrationCommand ?? '', root, [RESERVED_IDS.db, ...installOf(root)]);
    if (migrate) { tasks.push(migrate); databaseDeps.push(migrate.id); }
    const seed = oneOff(RESERVED_IDS.seed, database.seedCommand ?? '', root, [RESERVED_IDS.db, ...installOf(root), ...(migrate ? [migrate.id] : [])]);
    if (seed) { tasks.push(seed); databaseDeps.push(seed.id); }
  }

  const services: ServiceSpec[] = blueprint.services.map((service) => {
    const serviceRole = roleOfService(service);
    const root = runtimeRoot(service.rootDir);
    const port = serviceDevPort(service);
    const declared = (service.dependsOn ?? []).map((dep) => ids.get(dep) ?? dep);
    const defaults = service.dependsOn
      ? []
      : serviceRole === 'frontend' ? backends.map((backend) => ids.get(backend.id)!) : [];
    const dependsOn = unique([
      ...installOf(root), ...declared, ...defaults,
      ...(serviceRole === 'backend' ? databaseDeps : []),
    ]);
    return {
      id: ids.get(service.id)!,
      type: 'application',
      runtime: KIND_RUNTIME[service.kind]?.runtime ?? service.kind,
      role: serviceRole,
      root,
      ...(commandOf(service.devCommand) ?? {}),
      ...(port !== undefined ? { port } : {}),
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
      readiness: readinessFor(service, port),
      restartPolicy: service.restartPolicy ?? 'on-failure',
    };
  });

  const env = Object.fromEntries(
    blueprint.vars.filter((v) => v.defaultValue !== undefined).map((v) => [v.name, v.defaultValue as string]),
  );

  return {
    projectId: String(blueprint.projectId),
    services: [...installs.values(), ...tasks, ...services],
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}
