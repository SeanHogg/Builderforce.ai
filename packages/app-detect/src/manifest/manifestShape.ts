/**
 * The app manifest v1 (`builderforce.json` with `"version": 1`) as this package reads and
 * writes it — STRUCTURAL types only. The manifest's own types, parser and validation live
 * in `@seanhogg/builderforce-webcontainers-core/manifest` (PRD 31 §W11 Rev 2 item 7);
 * these are the subset the blueprint adapter touches, written so that:
 *
 * - the published `AppManifest` is assignable to `ManifestInput` (a consumer hands its
 *   parsed manifest straight to `manifestToBlueprintOverrides`);
 * - `EmittedManifest` is assignable to the published `AppManifest` (what `emitManifest`
 *   writes is a v1 manifest by type, not only by test).
 *
 * When the release carrying `./manifest` lands, consumers switch to the published types;
 * these stay the adapter's minimal view.
 */

/** The canonical `$schema` URL of a v1 manifest. */
export const APP_MANIFEST_SCHEMA_URL = 'https://builderforce.ai/schema/app.v1.json';

// ---------------------------------------------------------------------------
// Reading: everything optional and loose — the file is untrusted input.
// ---------------------------------------------------------------------------

export interface ManifestReadinessInput {
  http?: string;
  port?: boolean;
  query?: boolean;
  exitZero?: boolean;
  started?: boolean;
  timeout?: string;
}

export interface ManifestServiceInput {
  runtime?: string;
  root?: string;
  command?: string;
  args?: string[];
  port?: number;
  role?: string;
  uses?: string[];
  dependsOn?: string[];
  readiness?: ManifestReadinessInput;
  restart?: string;
  env?: Record<string, string>;
}

export interface ManifestResourceInput {
  type?: string;
}

export interface ManifestInput {
  version: 1;
  name?: string;
  resources?: Record<string, ManifestResourceInput>;
  services?: Record<string, ManifestServiceInput>;
  jobs?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Writing: exactly the shapes `emitManifest` produces.
// ---------------------------------------------------------------------------

export type EmittedReadiness = { http: string } | { port: true } | { exitZero: true } | { started: true };

export type EmittedRestart = 'never' | 'on-failure' | 'always';

export interface EmittedService {
  runtime: string;
  root: string;
  command: string;
  port?: number;
  role?: 'frontend' | 'backend';
  uses?: string[];
  dependsOn?: string[];
  readiness?: EmittedReadiness;
  restart?: EmittedRestart;
  env?: Record<string, string>;
}

export type EmittedResource =
  | { type: 'postgres'; persistent: true; extensions?: string[] }
  | { type: 'redis' }
  | { type: 'queue'; engine: 'native' }
  | { type: 'object-storage' }
  | { type: 'mail' };

export interface EmittedJob {
  schedule: string;
  invoke: { service: string; method: 'GET'; path: string };
}

export interface EmittedEnvironment {
  target: 'browser';
  tier: 'non-production';
  debug: true;
}

export interface EmittedManifest {
  $schema: string;
  version: 1;
  name?: string;
  resources?: Record<string, EmittedResource>;
  services: Record<string, EmittedService>;
  jobs?: Record<string, EmittedJob>;
  environments: Record<string, EmittedEnvironment>;
}
