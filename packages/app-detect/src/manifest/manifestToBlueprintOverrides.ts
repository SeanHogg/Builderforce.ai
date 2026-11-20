/**
 * A `builderforce.json` v1 manifest → the blueprint fields it states (services, database,
 * vars), as `overrides` that `applyOverrides` lays over detection. The inverse of
 * `emitManifest`: its one-off `<id>-install` services fold back into their services'
 * `installCommand`, and `db-migrate` / `db-seed` into the database's commands.
 *
 * The file is untrusted input: anything of the wrong shape, and anything the blueprint has
 * no field for (redis, queues, storage, mail, jobs, ingress, environments …), is a note — the
 * runtime reads those from the manifest itself. Pure.
 */

import type { AppBlueprint, AppDatabase, AppService, AppServiceReadiness, AppVar } from '@builderforce/creation-canvas-contract';
import { detectionNote, type DetectionNote } from '../notes';
import { INSTALL_SUFFIX, MANIFEST_RESERVED_IDS } from './emitManifest';
import type { ManifestInput, ManifestReadinessInput, ManifestServiceInput } from './manifestShape';
import { blueprintRootDir, kindOfRuntime, packageManagerOf, type ServiceRole } from './serviceRuntime';

export interface ManifestOverridesResult {
  overrides: Partial<AppBlueprint>;
  /** What the manifest states that the blueprint cannot hold, or could not be read — coded; English is `noteMessages(notes)`. */
  notes: DetectionNote[];
}

const RESTARTS = new Set(['never', 'on-failure', 'always']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

function commandLine(service: ManifestServiceInput): string {
  const args = strings(service.args);
  return [service.command!.trim(), ...args].join(' ');
}

function readinessOf(readiness: ManifestReadinessInput | undefined): AppServiceReadiness | undefined {
  if (!isRecord(readiness)) return undefined;
  if (typeof readiness.http === 'string') return { kind: 'http', path: readiness.http };
  if (readiness.port === true) return { kind: 'port' };
  if (readiness.exitZero === true) return { kind: 'exit-zero' };
  return undefined;
}

const isOneOff = (service: ManifestServiceInput): boolean =>
  isRecord(service.readiness) && service.readiness.exitZero === true && service.restart === 'never';

export function manifestToBlueprintOverrides(manifest: ManifestInput): ManifestOverridesResult {
  const notes: DetectionNote[] = [];
  const overrides: Partial<AppBlueprint> = {};
  const entries = Object.entries(isRecord(manifest.services) ? manifest.services : {}).filter(([id, service]) => {
    const usable = isRecord(service) && nonEmpty(service.runtime) && nonEmpty(service.command);
    if (!usable) notes.push(detectionNote('manifest-service-unreadable', { service: id }));
    return usable;
  });

  // The one-off steps `emitManifest` writes, folded back into what they install / migrate / seed.
  const installs = new Map(entries.filter(([id, s]) => id.endsWith(INSTALL_SUFFIX) && isOneOff(s)).map(([id, s]) => [id, commandLine(s)]));
  const steps = new Map(
    entries
      .filter(([id, s]) => (id === MANIFEST_RESERVED_IDS.migrate || id === MANIFEST_RESERVED_IDS.seed) && isOneOff(s))
      .map(([id, s]) => [id, commandLine(s)]),
  );
  const folded = new Set([...installs.keys(), ...steps.keys()]);

  const vars = new Map<string, string>();
  const services: AppService[] = [];
  for (const [id, service] of entries) {
    for (const [name, value] of Object.entries(isRecord(service.env) ? service.env : {})) {
      if (typeof value !== 'string') continue;
      if (vars.has(name) && vars.get(name) !== value) notes.push(detectionNote('manifest-env-differs', { name }));
      else vars.set(name, value);
    }
    if (folded.has(id)) continue;
    const role: ServiceRole = service.role === 'frontend' ? 'frontend' : 'backend';
    const port = typeof service.port === 'number' && Number.isInteger(service.port) ? service.port : undefined;
    const training = service.runtime === 'python' && port === undefined && isRecord(service.readiness)
      && service.readiness.started === true && service.restart === 'never';
    let kind = training ? 'training' as const : kindOfRuntime(service.runtime!, role);
    if (!kind) {
      notes.push(detectionNote('manifest-runtime-unknown', { service: id, runtime: service.runtime! }));
      kind = role === 'frontend' ? 'spa' : 'node';
    }
    if (isRecord(service.readiness) && service.readiness.query === true) notes.push(detectionNote('manifest-readiness-query', { service: id }));
    const dependsOn = strings(service.dependsOn);
    const installCommand = dependsOn.map((dep) => installs.get(dep)).find((line) => line !== undefined) ?? '';
    const ownDeps = dependsOn.filter((dep) => !folded.has(dep));
    const command = commandLine(service);
    const readiness = readinessOf(service.readiness);
    services.push({
      id,
      kind,
      rootDir: blueprintRootDir(service.root),
      packageManager: packageManagerOf(installCommand, service.runtime!),
      installCommand,
      devCommand: command,
      buildCommand: '',
      startCommand: command,
      verifyCommand: null,
      outputDir: null,
      ports: port === undefined ? [] : [port],
      envVars: Object.keys(isRecord(service.env) ? service.env : {}),
      isPrimary: false,
      ...(ownDeps.length > 0 ? { dependsOn: ownDeps } : {}),
      ...(readiness ? { readiness } : {}),
      ...(typeof service.restart === 'string' && RESTARTS.has(service.restart) ? { restartPolicy: service.restart as AppService['restartPolicy'] } : {}),
      ...(service.role === 'frontend' || service.role === 'backend' ? { role: service.role } : {}),
    });
  }
  const primary = services.find((s) => (s.role ?? (s.kind === 'spa' ? 'frontend' : 'backend')) === 'frontend') ?? services[0];
  if (primary) primary.isPrimary = true;
  if (isRecord(manifest.services)) overrides.services = services;

  if (isRecord(manifest.resources)) {
    let database: AppDatabase | null = null;
    for (const [id, resource] of Object.entries(manifest.resources)) {
      const type = isRecord(resource) && typeof resource.type === 'string' ? resource.type : 'unknown';
      if (type === 'postgres' && !database) {
        database = {
          engine: 'postgres',
          migrationCommand: steps.get(MANIFEST_RESERVED_IDS.migrate) ?? '',
          seedCommand: steps.get(MANIFEST_RESERVED_IDS.seed) ?? null,
          migrationsPath: '',
          connectionSecretName: 'DATABASE_URL',
        };
        continue;
      }
      notes.push(detectionNote('manifest-resource-unmapped', { id, type }));
    }
    overrides.database = database;
  }

  if (vars.size > 0) overrides.vars = [...vars].map(([name, defaultValue]): AppVar => ({ name, defaultValue }));
  if (isRecord(manifest.jobs) && Object.keys(manifest.jobs).length > 0) notes.push(detectionNote('manifest-jobs-unmapped', {}));
  if (isRecord(manifest.ingress) && Array.isArray(manifest.ingress.routes) && manifest.ingress.routes.length > 0) {
    notes.push(detectionNote('manifest-ingress-unmapped', {}));
  }
  return { overrides, notes };
}
