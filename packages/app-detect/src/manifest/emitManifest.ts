/**
 * `emitManifest(blueprint) → builderforce.json v1` (PRD 31 §W11 phase 2, `/manifest init`).
 * Pure and deterministic: the same blueprint always gives the same text, keys in a fixed order.
 *
 * It mirrors how the web run target runs a blueprint (`blueprintToApplicationSpec`), in
 * manifest terms, so the manifest runs the app the blueprint described:
 * - each service → a service on its kind's runtime (`KIND_MANIFEST_RUNTIME`), its dev command,
 *   its dev port (`serviceDevPort`; a port two services claim moves to the next free one, noted);
 * - each service root's install → one one-off service per (root, runtime): `<id>-install`,
 *   ready on exit 0, never restarted, which the services of that root and runtime depend on;
 * - a Postgres-compatible database → resource `db` (persistent), used by every backend;
 *   its migration and seed → one-off services `db-migrate` / `db-seed` every backend depends on;
 * - frontends with no declared `dependsOn` wait for every backend;
 * - wrangler cron bindings → jobs that invoke the Worker's scheduled route; queue and R2
 *   bindings → `queue` (native) and `object-storage` resources the Worker uses;
 * - compose resources (Redis, object storage, mail, Postgres) → resources, used by the
 *   services whose `depends_on` names them;
 * - vars with a value → every service's `env`; one environment, `local` (browser, debug);
 * - exactly one frontend and one HTTP backend (each with a port) AND evidence that the
 *   backend answers under `/api` (`AppDetection.ingressEvidence`: a dev proxy forwarding
 *   `/api` unchanged, or backend routes declared under it) → ingress: `/api` → the backend,
 *   `/` → the frontend (noted). The runtime's ingress does not strip the prefix, so with no
 *   evidence — or a dev proxy that rewrites `/api` away — no ingress is written, and a note
 *   says how to add one; any other shape has no single answer, so it gets none.
 *
 * Everything it cannot express (secrets, domains, other bindings, other database engines …)
 * is a note, never silently dropped.
 */

import type { AppBlueprint, AppService } from '@builderforce/creation-canvas-contract';
import { serviceDevPort } from '@builderforce/creation-canvas-contract';
import { detectionNote, type DetectionNote } from '../notes';
import type { ComposeResource, IngressEvidence } from '../types';
import {
  BACKEND_INGRESS_PATH,
  type EmittedIngressRoute,
  type EmittedJob,
  type EmittedManifest,
  type EmittedReadiness,
  type EmittedResource,
  type EmittedService,
} from './manifestShape';
import { KIND_MANIFEST_RUNTIME, PACKAGE_MANAGER_RUNTIME, runtimeRoot, safeId, type ServiceRole } from './serviceRuntime';

export interface EmitManifestExtras {
  /** Resources a `docker-compose.yml` declares (`AppDetection.composeResources`). */
  composeResources?: ComposeResource[];
  /** What the files say about serving the backend under `/api` (`AppDetection.ingressEvidence`); none: no ingress. */
  ingressEvidence?: readonly IngressEvidence[];
  /** The app's name; default: the primary service's id. */
  name?: string;
}

export interface EmitManifestResult {
  manifest: EmittedManifest;
  /** `manifest` as the file's text: two-space JSON and a trailing newline. */
  text: string;
  /**
   * What the manifest could not express, coded — the one stored form: hosts that localize
   * word each from `code` + `params`, the others take `noteMessages(notes)`.
   */
  notes: DetectionNote[];
}

/** Ids the database and its steps always get (the run target's reserved ids). */
export const MANIFEST_RESERVED_IDS = { db: 'db', migrate: 'db-migrate', seed: 'db-seed' } as const;

/** The route a Cloudflare Worker's scheduled handler is invoked on in local dev (`wrangler dev --test-scheduled`). */
export const SCHEDULED_ROUTE = '/__scheduled';

/** The suffix of a one-off install service's id. */
export const INSTALL_SUFFIX = '-install';

const POSTGRES_ENGINES = new Set(['postgres', 'neon']);

const isTraining = (service: AppService): boolean => service.kind === 'training';

function roleOf(service: AppService): ServiceRole {
  return service.role ?? KIND_MANIFEST_RUNTIME[service.kind]?.role ?? 'backend';
}

function runtimeOf(service: AppService): string {
  return KIND_MANIFEST_RUNTIME[service.kind]?.runtime ?? 'node';
}

function readinessOf(service: AppService): EmittedReadiness | undefined {
  if (isTraining(service)) return { started: true };
  switch (service.readiness?.kind) {
    case 'http': return { http: service.readiness.path };
    case 'port': return { port: true };
    case 'exit-zero': return { exitZero: true };
    default: return undefined;
  }
}

/** A service entry with its keys in the manifest's order, empty ones left out. */
function serviceEntry(fields: EmittedService): EmittedService {
  const entry: EmittedService = { runtime: fields.runtime, root: fields.root, command: fields.command };
  if (fields.port !== undefined) entry.port = fields.port;
  if (fields.role) entry.role = fields.role;
  if (fields.uses && fields.uses.length > 0) entry.uses = [...new Set(fields.uses)];
  if (fields.dependsOn && fields.dependsOn.length > 0) entry.dependsOn = [...new Set(fields.dependsOn)];
  if (fields.readiness) entry.readiness = fields.readiness;
  if (fields.restart) entry.restart = fields.restart;
  if (fields.env && Object.keys(fields.env).length > 0) entry.env = fields.env;
  return entry;
}

/** A one-off step (install, migrate, seed): runs to exit 0, never restarts. */
function oneOff(runtime: string, root: string, command: string, extra: Pick<EmittedService, 'uses' | 'dependsOn' | 'env'> = {}): EmittedService {
  return serviceEntry({ runtime, root, command, ...extra, readiness: { exitZero: true }, restart: 'never' });
}

/** Turn every binding, the database and the compose resources into resources; who uses which. */
function emitResources(blueprint: AppBlueprint, compose: ComposeResource[], taken: Set<string>, notes: DetectionNote[]) {
  const resources: Record<string, EmittedResource> = {};
  /** Blueprint service id → resource ids its compose `depends_on` named. */
  const usedBy = new Map<string, string[]>();
  /** Resources the Worker's bindings name: used by every Worker service. */
  const bindingResources: string[] = [];
  const use = (serviceId: string, resourceId: string): void => {
    usedBy.set(serviceId, [...(usedBy.get(serviceId) ?? []), resourceId]);
  };

  const database = blueprint.database;
  let hasDatabase = false;
  if (database) {
    if (POSTGRES_ENGINES.has(database.engine)) {
      resources[MANIFEST_RESERVED_IDS.db] = { type: 'postgres', persistent: true };
      hasDatabase = true;
      if (database.engine !== 'postgres') notes.push(detectionNote('db-engine-as-postgres', { engine: database.engine }));
      if (database.provider) notes.push(detectionNote('db-provider-dropped', { provider: database.provider }));
    } else {
      notes.push(detectionNote('db-engine-unsupported', { engine: database.engine }));
    }
  }

  for (const resource of compose) {
    if (resource.type === 'postgres' && hasDatabase) {
      const db = resources[MANIFEST_RESERVED_IDS.db] as Extract<EmittedResource, { type: 'postgres' }>;
      if (resource.extensions) db.extensions = [...new Set([...(db.extensions ?? []), ...resource.extensions])];
      for (const serviceId of resource.usedBy) use(serviceId, MANIFEST_RESERVED_IDS.db);
      notes.push(detectionNote('compose-postgres-is-db', { id: resource.id, image: resource.image }));
      continue;
    }
    const id = safeId(resource.id, taken);
    if (resource.type === 'postgres') {
      resources[id] = { type: 'postgres', persistent: true, ...(resource.extensions ? { extensions: resource.extensions } : {}) };
      notes.push(detectionNote('compose-postgres-no-migration', { id: resource.id }));
    } else {
      resources[id] = { type: resource.type };
    }
    for (const serviceId of resource.usedBy) use(serviceId, id);
  }

  for (const binding of blueprint.bindings) {
    if (binding.kind === 'cron') continue; // jobs
    if (binding.kind === 'queue' || binding.kind === 'r2') {
      const id = safeId(binding.name.toLowerCase(), taken);
      resources[id] = binding.kind === 'queue' ? { type: 'queue', engine: 'native' } : { type: 'object-storage' };
      bindingResources.push(id);
      if (binding.kind === 'queue') notes.push(detectionNote('queue-as-native', { binding: binding.name, id }));
      continue;
    }
    notes.push(detectionNote('binding-unsupported', { kind: binding.kind, binding: binding.name }));
  }
  return { resources, usedBy, bindingResources, hasDatabase };
}

/** One port per service: a port already claimed moves to the next free one. */
function allocatePorts(services: AppService[], ids: Map<string, string>, notes: DetectionNote[]): Map<string, number> {
  const claimed = new Set<number>();
  const ports = new Map<string, number>();
  for (const service of services) {
    if (isTraining(service)) continue;
    const wanted = serviceDevPort(service);
    if (wanted === undefined) continue;
    let port = wanted;
    while (claimed.has(port)) port++;
    claimed.add(port);
    ports.set(service.id, port);
    if (port !== wanted) {
      notes.push(detectionNote('port-moved', { service: String(ids.get(service.id)), wanted, port, command: String(service.devCommand) }));
    }
  }
  return ports;
}

function emitJobs(blueprint: AppBlueprint, ids: Map<string, string>, notes: DetectionNote[]): Record<string, EmittedJob> {
  const jobs: Record<string, EmittedJob> = {};
  const crons = blueprint.bindings.filter((binding) => binding.kind === 'cron' && binding.cron);
  if (crons.length === 0) return jobs;
  const host = blueprint.services.find((service) => service.kind === 'worker')
    ?? blueprint.services.find((service) => roleOf(service) === 'backend' && !isTraining(service));
  if (!host) {
    notes.push(detectionNote('cron-no-backend', { schedules: crons.map((c) => String(c.cron)) }));
    return jobs;
  }
  const service = ids.get(host.id)!;
  const taken = new Set<string>();
  for (const schedule of crons.flatMap((binding) => binding.cron!.split(',').map((s) => s.trim()).filter(Boolean))) {
    jobs[safeId('cron', taken)] = { schedule, invoke: { service, method: 'GET', path: SCHEDULED_ROUTE } };
  }
  notes.push(detectionNote('cron-scheduled-route', { service, path: SCHEDULED_ROUTE }));
  return jobs;
}

/** Is the repo-relative `file` inside the service root `root` (`/` = the whole repo, `/api` = `api/…`)? */
function isUnder(file: string, root: string): boolean {
  const dir = root.replace(/^\/+|\/+$/g, '');
  return dir === '' || file.startsWith(`${dir}/`);
}

/**
 * The ingress for exactly one frontend and one HTTP backend among the written services (a
 * route needs a port to reach): `/api` → the backend, `/` → the frontend, longest path first
 * — only on evidence the backend answers under `/api`, since the runtime passes the path
 * through unchanged. Backend routes in a file under the backend's root, or an unrewritten
 * dev proxy in a file under the frontend's root, are that evidence (a `mock/server.js`
 * beside them is not); a dev proxy that rewrites the path, or nothing at all, gets no
 * ingress and a note. More than one frontend or backend has no single answer: no ingress,
 * and a note naming them.
 */
function emitIngress(services: Record<string, EmittedService>, allEvidence: readonly IngressEvidence[], notes: DetectionNote[]): EmittedIngressRoute[] {
  // One-off steps and training services have no port, so only the long-running HTTP services remain.
  const served = Object.entries(services).filter(([, entry]) => entry.port !== undefined);
  const frontends = served.filter(([, entry]) => entry.role === 'frontend');
  const backends = served.filter(([, entry]) => (entry.role ?? 'backend') === 'backend');
  const path = BACKEND_INGRESS_PATH;
  if (frontends.length > 1 || backends.length > 1) {
    notes.push(detectionNote('ingress-ambiguous', { frontends: frontends.map(([id]) => id), backends: backends.map(([id]) => id), path }));
    return [];
  }
  if (frontends.length !== 1 || backends.length !== 1) return [];
  const [[frontend, frontendEntry], [backend, backendEntry]] = [frontends[0]!, backends[0]!];
  // Evidence counts only from its own service's files: routes from the backend's root, a dev proxy from the frontend's.
  const evidence = allEvidence.filter((item) =>
    isUnder(item.file, item.kind === 'backend-routes' ? backendEntry.root : frontendEntry.root));
  if (evidence.some((item) => item.kind !== 'proxy-rewrite')) {
    notes.push(detectionNote('ingress-api-backend', { frontend, backend, path }));
    return [{ path, service: backend }, { path: '/', service: frontend }];
  }
  const rewrite = evidence.find((item) => item.kind === 'proxy-rewrite');
  notes.push(rewrite
    ? detectionNote('ingress-proxy-rewrites', { frontend, backend, path, file: rewrite.file })
    : detectionNote('ingress-not-inferred', { frontend, backend, path }));
  return [];
}

export function emitManifest(blueprint: AppBlueprint, extras: EmitManifestExtras = {}): EmitManifestResult {
  const notes: DetectionNote[] = [];
  const taken = new Set<string>(Object.values(MANIFEST_RESERVED_IDS));
  const { resources, usedBy, bindingResources, hasDatabase } = emitResources(blueprint, extras.composeResources ?? [], taken, notes);
  const ids = new Map(blueprint.services.map((service) => [service.id, safeId(service.id, taken)]));
  const backends = blueprint.services.filter((service) => roleOf(service) === 'backend' && !isTraining(service));
  const workers = blueprint.services.filter((service) => service.kind === 'worker');

  // One install per service root AND runtime, before anything of that runtime in that root runs.
  const installKey = (root: string, runtime: string): string => `${root}|${runtime}`;
  const installs = new Map<string, { id: string; entry: EmittedService }>();
  for (const service of blueprint.services) {
    const line = service.installCommand?.trim();
    if (!line) continue;
    const root = runtimeRoot(service.rootDir);
    const runtime = PACKAGE_MANAGER_RUNTIME[service.packageManager] ?? runtimeOf(service);
    const key = installKey(root, runtime);
    if (installs.has(key)) continue;
    installs.set(key, { id: safeId(`${ids.get(service.id)}${INSTALL_SUFFIX}`, taken), entry: oneOff(runtime, root, line) });
  }
  const installOf = (service: AppService | undefined, runtime?: string): string[] => {
    if (!service) return [];
    const key = installKey(runtimeRoot(service.rootDir), runtime ?? PACKAGE_MANAGER_RUNTIME[service.packageManager] ?? runtimeOf(service));
    const install = installs.get(key);
    return install ? [install.id] : [];
  };

  const env = Object.fromEntries(
    blueprint.vars.filter((v) => v.defaultValue !== undefined).map((v) => [v.name, v.defaultValue as string]),
  );
  const unset = blueprint.vars.filter((v) => v.defaultValue === undefined).map((v) => v.name);
  if (unset.length > 0) notes.push(detectionNote('vars-unset', { names: unset }));

  // The database's migration and seed run where the first backend lives, on its runtime, after its install.
  const steps: Record<string, EmittedService> = {};
  const stepIds: string[] = [];
  if (hasDatabase && blueprint.database) {
    const host = backends[0];
    const runtime = host ? runtimeOf(host) : 'node';
    const root = runtimeRoot(host?.rootDir);
    const migration = blueprint.database.migrationCommand?.trim();
    const seed = blueprint.database.seedCommand?.trim();
    const step = (id: string, command: string): void => {
      steps[id] = oneOff(runtime, root, command, { uses: [MANIFEST_RESERVED_IDS.db], dependsOn: [...installOf(host, runtime), ...stepIds], env });
      stepIds.push(id);
    };
    if (migration) step(MANIFEST_RESERVED_IDS.migrate, migration);
    if (seed) step(MANIFEST_RESERVED_IDS.seed, seed);
  }

  const ports = allocatePorts(blueprint.services, ids, notes);
  const services: Record<string, EmittedService> = {};
  for (const install of installs.values()) services[install.id] = install.entry;
  Object.assign(services, steps);
  for (const service of blueprint.services) {
    const id = ids.get(service.id)!;
    const role = roleOf(service);
    const command = service.devCommand?.trim() || service.startCommand?.trim();
    if (!command) {
      notes.push(detectionNote('service-no-command', { service: id }));
      continue;
    }
    const isBackend = role === 'backend' && !isTraining(service);
    const composeUses = usedBy.get(service.id) ?? [];
    if (role === 'frontend' && composeUses.length > 0) notes.push(detectionNote('frontend-no-credentials', { service: id, resources: composeUses }));
    const uses = isBackend
      ? [...(hasDatabase ? [MANIFEST_RESERVED_IDS.db] : []), ...composeUses, ...(service.kind === 'worker' || workers.length === 0 ? bindingResources : [])]
      : [];
    const declared = (service.dependsOn ?? []).map((dep) => ids.get(dep) ?? dep);
    const defaults = service.dependsOn ? [] : role === 'frontend' ? backends.map((backend) => ids.get(backend.id)!) : [];
    if (isTraining(service)) notes.push(detectionNote('training-as-python', { service: id }));
    if (service.kind === 'worker') notes.push(detectionNote('worker-own-command', { service: id, command }));
    if (service.kind === 'container') notes.push(detectionNote('container-needs-docker', { service: id }));
    services[id] = serviceEntry({
      runtime: runtimeOf(service),
      root: runtimeRoot(service.rootDir),
      command,
      port: ports.get(service.id),
      // `backend` is the manifest's default: written only when the blueprint says so.
      role: (service.role || role === 'frontend') ? role : undefined,
      uses,
      dependsOn: [...installOf(service), ...declared, ...defaults, ...(isBackend ? stepIds : [])],
      readiness: readinessOf(service),
      restart: service.restartPolicy ?? (isTraining(service) ? 'never' : undefined),
      env,
    });
  }

  const jobs = emitJobs(blueprint, ids, notes);
  const routes = emitIngress(services, extras.ingressEvidence ?? [], notes);
  const secrets = blueprint.secrets.map((secret) => secret.name);
  if (secrets.length > 0) notes.push(detectionNote('secrets-to-vault', { names: secrets }));
  if (blueprint.domains.length > 0) notes.push(detectionNote('domains-dropped', { domains: blueprint.domains.map((d) => d.domain) }));

  const primary = blueprint.services.find((service) => service.isPrimary) ?? blueprint.services[0];
  const name = extras.name ?? (primary ? ids.get(primary.id) : undefined);
  const manifest: EmittedManifest = {
    version: 1,
    ...(name ? { name } : {}),
    ...(Object.keys(resources).length > 0 ? { resources } : {}),
    services,
    ...(Object.keys(jobs).length > 0 ? { jobs } : {}),
    ...(routes.length > 0 ? { ingress: { routes } } : {}),
    environments: { local: { target: 'browser', tier: 'non-production', debug: true } },
  };
  return { manifest, text: `${JSON.stringify(manifest, null, 2)}\n`, notes };
}
