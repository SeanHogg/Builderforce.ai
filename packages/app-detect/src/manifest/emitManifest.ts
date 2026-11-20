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
 * - vars with a value → every service's `env`; one environment, `local` (browser, debug).
 *
 * Everything it cannot express (secrets, domains, other bindings, other database engines …)
 * is a note, never silently dropped.
 */

import type { AppBlueprint, AppService } from '@builderforce/creation-canvas-contract';
import { serviceDevPort } from '@builderforce/creation-canvas-contract';
import type { ComposeResource } from '../types';
import {
  APP_MANIFEST_SCHEMA_URL,
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
  /** The app's name; default: the primary service's id. */
  name?: string;
}

export interface EmitManifestResult {
  manifest: EmittedManifest;
  /** `manifest` as the file's text: two-space JSON and a trailing newline. */
  text: string;
  /** What the manifest could not express, one sentence each. */
  notes: string[];
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
function emitResources(blueprint: AppBlueprint, compose: ComposeResource[], taken: Set<string>, notes: string[]) {
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
      if (database.engine !== 'postgres') notes.push(`The ${database.engine} database is written as a postgres resource: the target picks its host (PGlite in the browser).`);
      if (database.provider) notes.push(`The database provider "${database.provider}" is not part of the manifest: the target picks its host.`);
    } else {
      notes.push(`The ${database.engine} database is not expressible in manifest v1 (postgres only), so no database resource was written.`);
    }
  }

  for (const resource of compose) {
    if (resource.type === 'postgres' && hasDatabase) {
      const db = resources[MANIFEST_RESERVED_IDS.db] as Extract<EmittedResource, { type: 'postgres' }>;
      if (resource.extensions) db.extensions = [...new Set([...(db.extensions ?? []), ...resource.extensions])];
      for (const serviceId of resource.usedBy) use(serviceId, MANIFEST_RESERVED_IDS.db);
      notes.push(`The compose service "${resource.id}" (${resource.image}) is the database, written as "db".`);
      continue;
    }
    const id = safeId(resource.id, taken);
    if (resource.type === 'postgres') {
      resources[id] = { type: 'postgres', persistent: true, ...(resource.extensions ? { extensions: resource.extensions } : {}) };
      notes.push(`The compose postgres "${resource.id}" has no migration step: run your migrations against it yourself.`);
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
      if (binding.kind === 'queue') notes.push(`The queue binding ${binding.name} is written as a native queue ("${id}"): the browser runtime runs queues on a redis resource.`);
      continue;
    }
    notes.push(`The ${binding.kind} binding ${binding.name} is not expressible in manifest v1.`);
  }
  return { resources, usedBy, bindingResources, hasDatabase };
}

/** One port per service: a port already claimed moves to the next free one. */
function allocatePorts(services: AppService[], ids: Map<string, string>, notes: string[]): Map<string, number> {
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
    if (port !== wanted) notes.push(`Service "${ids.get(service.id)}" also wanted port ${wanted}, so it was given ${port}: tell its command (${service.devCommand}).`);
  }
  return ports;
}

function emitJobs(blueprint: AppBlueprint, ids: Map<string, string>, notes: string[]): Record<string, EmittedJob> {
  const jobs: Record<string, EmittedJob> = {};
  const crons = blueprint.bindings.filter((binding) => binding.kind === 'cron' && binding.cron);
  if (crons.length === 0) return jobs;
  const host = blueprint.services.find((service) => service.kind === 'worker')
    ?? blueprint.services.find((service) => roleOf(service) === 'backend' && !isTraining(service));
  if (!host) {
    notes.push(`The cron schedules (${crons.map((c) => c.cron).join('; ')}) have no backend service to invoke, so no job was written.`);
    return jobs;
  }
  const service = ids.get(host.id)!;
  const taken = new Set<string>();
  for (const schedule of crons.flatMap((binding) => binding.cron!.split(',').map((s) => s.trim()).filter(Boolean))) {
    jobs[safeId('cron', taken)] = { schedule, invoke: { service, method: 'GET', path: SCHEDULED_ROUTE } };
  }
  notes.push(`Each cron job invokes GET ${SCHEDULED_ROUTE} on "${service}": a Cloudflare scheduled handler needs a route — \`wrangler dev --test-scheduled\` serves it; elsewhere the app must.`);
  return jobs;
}

export function emitManifest(blueprint: AppBlueprint, extras: EmitManifestExtras = {}): EmitManifestResult {
  const notes: string[] = [];
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
  if (unset.length > 0) notes.push(`Variables with no value are not written: ${unset.join(', ')}.`);

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
      notes.push(`Service "${id}" has no dev or start command, so it was left out.`);
      continue;
    }
    const isBackend = role === 'backend' && !isTraining(service);
    const composeUses = usedBy.get(service.id) ?? [];
    if (role === 'frontend' && composeUses.length > 0) notes.push(`Frontend "${id}" never receives credentials, so it does not use ${composeUses.join(', ')}.`);
    const uses = isBackend
      ? [...(hasDatabase ? [MANIFEST_RESERVED_IDS.db] : []), ...composeUses, ...(service.kind === 'worker' || workers.length === 0 ? bindingResources : [])]
      : [];
    const declared = (service.dependsOn ?? []).map((dep) => ids.get(dep) ?? dep);
    const defaults = service.dependsOn ? [] : role === 'frontend' ? backends.map((backend) => ids.get(backend.id)!) : [];
    if (isTraining(service)) notes.push(`Training service "${id}" is written as a python service that is ready once started (manifest v1 has no training type).`);
    if (service.kind === 'worker') notes.push(`Worker "${id}" runs through its own command (${command}); the browser runtime has no workerd.`);
    if (service.kind === 'container') notes.push(`Container "${id}" needs a docker runtime, which the browser runtime does not have.`);
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
  const secrets = blueprint.secrets.map((secret) => secret.name);
  if (secrets.length > 0) notes.push(`Secrets are never written to the file: set ${secrets.join(', ')} in the vault.`);
  if (blueprint.domains.length > 0) notes.push(`Domains are not part of manifest v1: ${blueprint.domains.map((d) => d.domain).join(', ')}.`);

  const primary = blueprint.services.find((service) => service.isPrimary) ?? blueprint.services[0];
  const name = extras.name ?? (primary ? ids.get(primary.id) : undefined);
  const manifest: EmittedManifest = {
    $schema: APP_MANIFEST_SCHEMA_URL,
    version: 1,
    ...(name ? { name } : {}),
    ...(Object.keys(resources).length > 0 ? { resources } : {}),
    services,
    ...(Object.keys(jobs).length > 0 ? { jobs } : {}),
    environments: { local: { target: 'browser', tier: 'non-production', debug: true } },
  };
  return { manifest, text: `${JSON.stringify(manifest, null, 2)}\n`, notes };
}
