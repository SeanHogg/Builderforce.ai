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
 *
 * This module is the ONE owner of the v1 shape on this side of the published package —
 * the writing types, the schema URL, the file name and the backend ingress path. It is
 * dependency-free and exported as the `@builderforce/app-detect/manifest` subpath, so a
 * writer that is not a detector (the starter kits' `composeKit`) imports it without the
 * detection pipeline.
 */

/*
 * No `$schema` is written. The runtime's schema requires only `version`, and a document's own
 * `$schema` wins over an editor's association: while its URL did not resolve, every written
 * manifest showed a schema-load problem. The VS Code extension associates the schema by path
 * (`contributes.jsonValidation`), from the runtime's own `APP_MANIFEST_SCHEMA_V1`.
 */

/*
 * WHERE the manifest lives (PRD 49): `.builderforce/builderforce.json`. A root
 * `builderforce.json` / `bfwc.app.json` left by an older version is read as a fallback and
 * never written. The runtime owns this contract (`@seanhogg/builderforce-webcontainers/manifest`:
 * `MANIFEST_FILE`, `WORKSPACE_DIR`, `LEGACY_MANIFEST_FILES`), but that module is Node-only (it
 * reads the filesystem) and this package is dependency-free and bundled into Workers and the
 * browser, so the path is stated ONCE here for every pure consumer (the detectors, the starter
 * kits). The VS Code extension's manifest contract test pins these equal to the runtime's.
 */

/** The manifest's file name. */
export const MANIFEST_FILE_NAME = 'builderforce.json';

/** The project folder the manifest lives in. */
export const MANIFEST_DIR = '.builderforce';

/** The manifest's project-relative POSIX path: the ONLY path a writer uses. */
export const MANIFEST_PATH = `${MANIFEST_DIR}/${MANIFEST_FILE_NAME}`;

/** Root manifests an older version wrote, in read order: read as a fallback, never written. */
export const LEGACY_MANIFEST_PATHS = [MANIFEST_FILE_NAME, 'bfwc.app.json'] as const;

/** Every path a reader tries, canonical first. */
export const MANIFEST_READ_PATHS: readonly string[] = [MANIFEST_PATH, ...LEGACY_MANIFEST_PATHS];

/** The ingress path the one HTTP backend is served under (`emitManifest`'s ingress, the kits' backend parts). */
export const BACKEND_INGRESS_PATH = '/api';

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
  ingress?: { routes?: unknown };
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

/** An environment either writer emits: `emitManifest`'s local browser one, the starter kits' local + production ones. */
export interface EmittedEnvironment {
  target: 'browser' | 'cloudflare' | 'aws' | 'azure' | 'gcp';
  tier: 'production' | 'non-production';
  /** Non-production only. */
  debug?: boolean;
}

export interface EmittedIngressRoute {
  path: string;
  service: string;
}

export interface EmittedManifest {
  version: 1;
  name?: string;
  resources?: Record<string, EmittedResource>;
  services: Record<string, EmittedService>;
  jobs?: Record<string, EmittedJob>;
  ingress?: { routes: EmittedIngressRoute[] };
  environments: Record<string, EmittedEnvironment>;
}
