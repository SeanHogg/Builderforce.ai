/**
 * `AppBlueprint` → `ApplicationSpec` (PRD 31 §W9 phase 5) — the ONE mapping from what
 * the app IS (W2) to what the browser runtime runs. Pure: no runtime, no network.
 *
 * - Each blueprint service becomes an `application` service on the runtime its `kind`
 *   names (`KIND_RUNTIME`) — for a process runtime (Node, Python, PHP), the one its
 *   command belongs to (`commandRuntime`) — with its dev command, dev port (declared,
 *   else the kind's default — `serviceDevPort`), `dependsOn`, readiness and restart policy.
 * - A Postgres-compatible database (`postgres`, `neon`) becomes a persistent PGlite
 *   `database` service with the reserved id `db`; any other engine, or a blueprint that
 *   pins another provider (`neon-branch`), is mapped as-is so PGlite declines it by name.
 * - `migrationCommand` / `seedCommand` become one-off (`exit-zero`) services that every
 *   backend depends on, so the API starts only on a migrated, seeded database.
 * - Each service root gets one one-off install service per runtime its services install
 *   with, on the runtime of its command (`npm install` → node, `pip install -r …` → python,
 *   `composer install` → php) — Laravel's root holds both npm's and composer's. A service,
 *   migration or seed depends on the install in its root for its command's runtime.
 * - Every service gets its own port (`servicePorts`): one that collides (two same-family
 *   backends on their kind's default — Python and PHP 8000, .NET and Rust 8080) moves to
 *   the next free port, its dev command told so, and its dependents' `localhost:OLD`
 *   with it; a service whose command cannot be told is declined (`mapBlueprint`).
 * - A `training` service (a Python training script, phase 7) becomes a runtime `training`
 *   service on `python`: no port, the runtime's readiness (`started`) and restart (`never`)
 *   defaults, after its root's install; no frontend waits on it.
 * - Only browser-only frontends (an SPA, Vite) are `frontend`: they never depend on the
 *   database, so they never receive `DATABASE_URL`. SSR frameworks (Next, Remix,
 *   SvelteKit, Astro) run server code, so they are backends and do.
 */
import { runtimeRoot, safeId } from '@builderforce/app-detect';
import type { AppBlueprint, AppService, ServiceKind } from '@builderforce/creation-canvas-contract';
import type { ApplicationSpec, ReadinessSpec, ServiceRole, ServiceSpec } from '@seanhogg/builderforce-webcontainers/app';
import { COMMAND_RUNTIMES, commandOf, commandRuntime, commandWords, ENV_PREFIX, PROCESS_RUNTIME, shellSegments } from './commandLine';
import { allocatePorts, bindService, propagateMoves } from './servicePorts';

export { commandOf, commandRuntime, commandWords } from './commandLine';
// The ONE root and id rules, shared with `emitManifest` (the same blueprint, written as a manifest).
export { runtimeRoot } from '@builderforce/app-detect';

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
  python: { runtime: 'python', role: 'backend' },
  php: { runtime: 'php', role: 'backend' },
  dotnet: { runtime: 'dotnet', role: 'backend' },
  rust: { runtime: 'rust', role: 'backend' },
  // A Python training script (`python train.py`): a `training` service, never a server.
  training: { runtime: 'python', role: 'backend' },
};

/** A blueprint `training` service becomes a runtime `training` service: no port, ready once started, checkpointed on stop. */
export const isTrainingKind = (kind: ServiceKind): boolean => kind === 'training';

/** Kinds on these runtimes run whatever their command is; any other kind is declined by its kind. */
const PROCESS_RUNTIMES = new Set([PROCESS_RUNTIME, ...COMMAND_RUNTIMES.map((entry) => entry.runtime)]);

/** Database engines PGlite stands in for, mapped to the engine name the runtime takes. */
const POSTGRES_ENGINES: Readonly<Record<string, string>> = { postgres: 'postgres', neon: 'postgres' };

/** The port the browser database listens on (the app sees it in `DATABASE_URL`). */
export const BROWSER_DATABASE_PORT = 5432;

/** Ids the database and its steps always get, so a service can never take them. */
export const RESERVED_IDS = { db: 'db', migrate: 'db-migrate', seed: 'db-seed' } as const;

/** The runtime a service of `kind` running `command` is on: its command's, for a process runtime; else its kind's. */
function serviceRuntime(kind: ServiceKind, command: string | undefined): string {
  const byKind = KIND_RUNTIME[kind]?.runtime ?? kind;
  return PROCESS_RUNTIMES.has(byKind) && command ? commandRuntime(command) : byKind;
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

/**
 * The commands of a shell line that belong to a language runtime (`pip install -r
 * requirements.txt && python app.py`), each as a service on that runtime — so the
 * runtime's OWN checks, file-based ones included (requirements.txt, composer.json), judge
 * what the shell will hand it. Nothing for a command that is not a shell line.
 */
export function shellRuntimeProbes(service: ServiceSpec): ServiceSpec[] {
  if (service.command !== 'bfsh' || service.args?.[0] !== '-c') return [];
  return shellSegments(service.args[1] ?? '').flatMap((segment) => {
    const words = commandWords(segment.text);
    while (words[0] !== undefined && ENV_PREFIX.test(words[0])) words.shift();
    const [first, ...rest] = words;
    const runtime = first ? commandRuntime(first) : PROCESS_RUNTIME;
    return runtime === PROCESS_RUNTIME ? [] : [{ ...service, runtime, command: first!, args: rest }];
  });
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
    id, type: 'application', runtime: commandRuntime(command.command), root, ...command,
    readiness: { kind: 'exit-zero' }, restartPolicy: 'never',
    ...(dependsOn.length > 0 ? { dependsOn } : {}),
  };
}

const unique = (ids: string[]): string[] => [...new Set(ids)];

export function roleOfService(service: AppService): ServiceRole {
  return service.role ?? KIND_RUNTIME[service.kind]?.role ?? 'backend';
}

/** The application to run, and why any of its services cannot run as mapped (`"<id>: <reason>"`). */
export interface MappedBlueprint {
  spec: ApplicationSpec;
  declined: string[];
}

/** The ONE mapping; `declined` names a service whose port could not be moved (its command cannot be told). */
export function mapBlueprint(blueprint: AppBlueprint): MappedBlueprint {
  const taken = new Set<string>(Object.values(RESERVED_IDS));
  const ids = new Map(blueprint.services.map((service) => [service.id, safeId(service.id, taken)]));
  // A training script is no frontend's backend (nothing waits on it) and hosts no database step.
  const backends = blueprint.services.filter((service) => roleOfService(service) === 'backend' && !isTrainingKind(service.kind));

  // One install per service root AND runtime, before anything of that runtime in that root
  // runs: a root may hold several (Laravel's package.json beside composer.json → npm AND composer).
  const installKey = (root: string, runtime: string): string => `${root}|${runtime}`;
  const installs = new Map<string, ServiceSpec>();
  for (const service of blueprint.services) {
    const root = runtimeRoot(service.rootDir);
    const line = service.installCommand?.trim();
    if (!line) continue;
    const key = installKey(root, commandRuntime(commandOf(line)?.command ?? ''));
    if (installs.has(key)) continue;
    const step = oneOff(safeId(`${ids.get(service.id)}-install`, taken), line, root, []);
    if (step) installs.set(key, step);
  }
  const installOf = (root: string, runtime: string): string[] => {
    const step = installs.get(installKey(root, runtime));
    return step ? [step.id] : [];
  };

  // The database, then its migration and seed — each run where the first backend whose
  // command is on the same runtime lives (else the first backend), after that runtime's install there.
  const tasks: ServiceSpec[] = [];
  const databaseDeps: string[] = [];
  const database = blueprint.database;
  const dbStep = (id: string, line: string, after: string[]): ServiceSpec | null => {
    const runtime = commandRuntime(commandOf(line)?.command ?? '');
    const host = backends.find((b) => commandRuntime(commandOf(b.devCommand)?.command ?? '') === runtime) ?? backends[0];
    const root = runtimeRoot(host?.rootDir);
    return oneOff(id, line, root, [RESERVED_IDS.db, ...installOf(root, runtime), ...after]);
  };
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
    const migrate = dbStep(RESERVED_IDS.migrate, database.migrationCommand ?? '', []);
    if (migrate) { tasks.push(migrate); databaseDeps.push(migrate.id); }
    const seed = dbStep(RESERVED_IDS.seed, database.seedCommand ?? '', migrate ? [migrate.id] : []);
    if (seed) { tasks.push(seed); databaseDeps.push(seed.id); }
  }

  // Every service gets its own port in the ONE runtime: the database's and the declared
  // ones first, then the defaults — a later Python or PHP API (8000), a .NET or Rust
  // service (8080) moves to the next free port, its command told so, or is declined.
  // A training service serves nothing, so it never holds a port (the runtime refuses one that does).
  const portable = blueprint.services.map((service) => (isTrainingKind(service.kind) ? { ...service, ports: [] } : service));
  const grants = allocatePorts(portable, database ? [BROWSER_DATABASE_PORT] : []);
  const declined: string[] = [];
  const moves: Array<{ id: string; from: number; to: number }> = [];
  const services: ServiceSpec[] = blueprint.services.map((service, index) => {
    const id = ids.get(service.id)!;
    const serviceRole = roleOfService(service);
    const root = runtimeRoot(service.rootDir);
    const { line, port, move, declined: why } = bindService(id, service.devCommand, grants[index]);
    if (why) declined.push(why);
    if (move) moves.push({ id, ...move });
    const declared = (service.dependsOn ?? []).map((dep) => ids.get(dep) ?? dep);
    const defaults = service.dependsOn
      ? []
      : serviceRole === 'frontend' ? backends.map((backend) => ids.get(backend.id)!) : [];
    const command = commandOf(line);
    const dependsOn = unique([
      // Its own command's runtime's install in its root (a Vite frontend: npm's; a PHP API: composer's).
      ...installOf(root, commandRuntime(command?.command ?? '')), ...declared, ...defaults,
      // A training script does not wait on the database (a failing migration never blocks it); it may declare `dependsOn: ['db']`.
      ...(serviceRole === 'backend' && !isTrainingKind(service.kind) ? databaseDeps : []),
    ]);
    if (isTrainingKind(service.kind)) {
      // The runtime's defaults hold: ready once started, never restarted; a declared policy wins.
      return {
        id, type: 'training', runtime: KIND_RUNTIME.training.runtime, root, ...(command ?? {}),
        ...(dependsOn.length > 0 ? { dependsOn } : {}),
        ...(service.restartPolicy ? { restartPolicy: service.restartPolicy } : {}),
      };
    }
    return {
      id,
      type: 'application',
      runtime: serviceRuntime(service.kind, command?.command),
      role: serviceRole,
      root,
      ...(command ?? {}),
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
    spec: {
      projectId: String(blueprint.projectId),
      services: propagateMoves([...installs.values(), ...tasks, ...services], moves, env),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    },
    declined,
  };
}

export function blueprintToApplicationSpec(blueprint: AppBlueprint): ApplicationSpec {
  return mapBlueprint(blueprint).spec;
}
