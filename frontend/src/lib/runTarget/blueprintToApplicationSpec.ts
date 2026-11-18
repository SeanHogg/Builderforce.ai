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
 * - Only browser-only frontends (an SPA, Vite) are `frontend`: they never depend on the
 *   database, so they never receive `DATABASE_URL`. SSR frameworks (Next, Remix,
 *   SvelteKit, Astro) run server code, so they are backends and do.
 */
import { serviceDevPort, type AppBlueprint, type AppService, type ServiceKind } from '@builderforce/creation-canvas-contract';
import { isPhpCommand, isPythonCommand, type ApplicationSpec, type ReadinessSpec, type ServiceRole, type ServiceSpec } from '@seanhogg/builderforce-webcontainers/app';

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
};

/**
 * The runtimes whose commands run as processes of the ONE preview runtime, each with
 * the runtime's OWN test of which commands are its (`isPythonCommand`: python, pip,
 * uvicorn, flask …; `isPhpCommand`: php, composer). Anything else — a Node binary, the
 * shell (which hands Python and PHP children to their runtimes itself) — is `node`.
 */
const COMMAND_RUNTIMES: ReadonlyArray<{ runtime: string; owns: (command: string) => boolean }> = [
  { runtime: 'python', owns: isPythonCommand },
  { runtime: 'php', owns: isPhpCommand },
];
const PROCESS_RUNTIME = 'node';
/** Kinds on these runtimes run whatever their command is; any other kind is declined by its kind. */
const PROCESS_RUNTIMES = new Set([PROCESS_RUNTIME, ...COMMAND_RUNTIMES.map((entry) => entry.runtime)]);

/** The runtime a command runs on: the one that owns it, else Node. */
export function commandRuntime(command: string): string {
  return COMMAND_RUNTIMES.find((entry) => entry.owns(command))?.runtime ?? PROCESS_RUNTIME;
}

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

/**
 * `npm run dev` → `npm ['run','dev']`; `vite --port 5173` → `npx ['vite',…]`; `a && b` → `bfsh ['-c','a && b']`.
 * A Python or PHP command (`uvicorn main:app`, `php -S …`, `composer install`) runs as it is, on its runtime.
 */
export function commandOf(line: string): { command: string; args: string[] } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (SHELL_SYNTAX.test(trimmed) || ENV_PREFIX.test(trimmed)) return { command: 'bfsh', args: ['-c', trimmed] };
  const [first, ...rest] = commandWords(trimmed);
  if (!first) return null;
  const asIs = RUNNERS.has(first) || commandRuntime(first) !== PROCESS_RUNTIME;
  return asIs ? { command: first, args: rest } : { command: 'npx', args: [first, ...rest] };
}

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

/** Where a shell line splits into commands (`&&`, `||`, `;`, `|`, `&`). */
const SHELL_SEPARATORS = /&&|\|\||[;|&]/;

/**
 * The commands of a shell line that belong to a language runtime (`pip install -r
 * requirements.txt && python app.py`), each as a service on that runtime — so the
 * runtime's OWN checks, file-based ones included (requirements.txt, composer.json), judge
 * what the shell will hand it. Nothing for a command that is not a shell line.
 */
export function shellRuntimeProbes(service: ServiceSpec): ServiceSpec[] {
  if (service.command !== 'bfsh' || service.args?.[0] !== '-c') return [];
  return (service.args[1] ?? '').split(SHELL_SEPARATORS).flatMap((segment) => {
    const words = commandWords(segment);
    while (words[0] !== undefined && ENV_PREFIX.test(words[0])) words.shift();
    const [first, ...rest] = words;
    const runtime = first ? commandRuntime(first) : PROCESS_RUNTIME;
    return runtime === PROCESS_RUNTIME ? [] : [{ ...service, runtime, command: first!, args: rest }];
  });
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
    id, type: 'application', runtime: commandRuntime(command.command), root, ...command,
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

  const services: ServiceSpec[] = blueprint.services.map((service) => {
    const serviceRole = roleOfService(service);
    const root = runtimeRoot(service.rootDir);
    const port = serviceDevPort(service);
    const declared = (service.dependsOn ?? []).map((dep) => ids.get(dep) ?? dep);
    const defaults = service.dependsOn
      ? []
      : serviceRole === 'frontend' ? backends.map((backend) => ids.get(backend.id)!) : [];
    const command = commandOf(service.devCommand);
    const dependsOn = unique([
      // Its own command's runtime's install in its root (a Vite frontend: npm's; a PHP API: composer's).
      ...installOf(root, commandRuntime(command?.command ?? '')), ...declared, ...defaults,
      ...(serviceRole === 'backend' ? databaseDeps : []),
    ]);
    return {
      id: ids.get(service.id)!,
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
    projectId: String(blueprint.projectId),
    services: [...installs.values(), ...tasks, ...services],
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}
