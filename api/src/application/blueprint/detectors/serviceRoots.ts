/**
 * W2: Service roots — the shared seam of the language detectors (Python, PHP) whose
 * service need not sit at the repo root.
 *
 * A full-stack repo keeps its backend beside the frontend: a Vite app at the root and a
 * FastAPI or Slim API in `api/`. A language detector therefore looks at the root AND the
 * conventional backend folders (`SERVICE_ROOTS`, data), emits one service per root that
 * holds its manifest, and its `reads` are every manifest path under every root — so
 * `readBlueprintSources` fetches them with no second list. Each service names its own
 * `rootDir`, so the run target installs and runs it there; services of different
 * detectors stay separate because their ids differ (`mergeServices` merges by id).
 */

import type { AppBlueprint, AppDatabase, AppService, ServiceKind } from '@builderforce/creation-canvas-contract';
import { DATABASE_ENGINES, SERVICE_KIND_DEV_PORTS } from '@builderforce/creation-canvas-contract';

/** The repo root (`''`) and the folders a full-stack repo conventionally keeps its backend in. */
export const SERVICE_ROOTS: readonly string[] = ['', 'api', 'backend', 'server'];

/** `('api', 'main.py')` → `api/main.py`; `('', 'main.py')` → `main.py`. */
export function pathUnder(root: string, file: string): string {
  return root ? `${root}/${file}` : file;
}

/** A detector's `reads`: each of `files` under each service root. */
export function readsUnderServiceRoots(files: readonly string[]): string[] {
  return SERVICE_ROOTS.flatMap((root) => files.map((file) => pathUnder(root, file)));
}

/** The repo's files seen from one service root (paths relative to it). */
export interface ServiceRootFiles {
  /** The root as `AppService.rootDir` names it (`.` for the repo root). */
  rootDir: string;
  /** The root's folder name (`''` at the repo root). */
  root: string;
  get(file: string): string | undefined;
  has(file: string): boolean;
}

export function serviceRootFiles(files: Map<string, string>, root: string): ServiceRootFiles {
  return {
    rootDir: root || '.',
    root,
    get: (file) => files.get(pathUnder(root, file)),
    has: (file) => files.has(pathUnder(root, file)),
  };
}

/** PEP 503 / Composer-style name normalisation: lower case, runs of `-_.` as one `-`. */
export function normalizePackageName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, '-');
}

/**
 * The service id: the folder it lives in (`api`), else the project's own name, else the
 * language. A folder name keeps a backend in `api/` from colliding with the root Node
 * package's id, which `mergeServices` would fold the two services into.
 */
export function serviceIdFor(root: string, projectName: string | undefined, language: string): string {
  return root || projectName?.trim() || language;
}

export interface ProcessServiceFields {
  id: string;
  kind: ServiceKind;
  rootDir: string;
  packageManager: AppService['packageManager'];
  installCommand: string;
  devCommand: string;
  isPrimary: boolean;
}

/**
 * A request-serving process service (Python, PHP): the dev command serves, so it is the
 * start command too; nothing is built; the port is the kind's default — the one table
 * the run target reads back (`SERVICE_KIND_DEV_PORTS`), which every dev command here names.
 */
export function processService(fields: ProcessServiceFields): AppService {
  return {
    ...fields,
    buildCommand: '',
    startCommand: fields.devCommand,
    verifyCommand: null,
    outputDir: null,
    ports: [devPortOf(fields.kind)],
    envVars: [],
  };
}

/** The dev port a process service's dev command names: its kind's default (`SERVICE_KIND_DEV_PORTS`, the one table). */
export function devPortOf(kind: ServiceKind): number {
  const port = SERVICE_KIND_DEV_PORTS[kind];
  if (port === null) throw new Error(`Service kind '${kind}' has no dev port`);
  return port;
}

/**
 * A Postgres database the service connects to through `DATABASE_URL` — the same
 * `AppDatabase` the Node ORM detectors emit, so the run target stands up the database
 * and makes every backend depend on it (and on its migration) exactly as it does for them.
 * An empty `migrationCommand` = no migration step.
 */
export function postgresDatabase(migrationCommand: string, migrationsPath: string): AppDatabase {
  return {
    engine: DATABASE_ENGINES.POSTGRES,
    migrationCommand,
    seedCommand: null,
    migrationsPath,
    connectionSecretName: 'DATABASE_URL',
  };
}

/** What a language detector finds at one service root. */
export interface RootDetection {
  service: AppService;
  database: AppDatabase | null;
}

/**
 * Run `detectRoot` at every service root: one service per root that holds one, and the
 * blueprint's database from the first root that uses one.
 */
export function detectAcrossServiceRoots(
  files: Map<string, string>,
  detectRoot: (files: Map<string, string>, root: string) => RootDetection | null,
): Partial<AppBlueprint> {
  const detected = SERVICE_ROOTS.map((root) => detectRoot(files, root)).filter((d): d is RootDetection => d !== null);
  if (detected.length === 0) return {};
  const database = detected.find((d) => d.database)?.database;
  return { services: detected.map((d) => d.service), ...(database ? { database } : {}) };
}

/**
 * A root `package.json` is the Node service, and the package.json detector makes it the
 * primary one — so a Python or PHP service beside it (in a backend folder, or at the root
 * as Laravel's Vite `package.json` sits beside `composer.json`) is not; on its own, it is.
 */
export function isPrimaryAt(files: Map<string, string>): boolean {
  return !files.has('package.json');
}

/** A `.env.example` that points `DATABASE_URL` at Postgres (`postgres://`, `postgresql+pg8000://` …). */
export const POSTGRES_DATABASE_URL = /^\s*DATABASE_URL\s*=\s*["']?postgres(?:ql)?(?:\+\w+)?:\/\//m;
