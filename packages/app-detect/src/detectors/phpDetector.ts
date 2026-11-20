/**
 * W2: PHP detector
 *
 * A PHP service (`kind: 'php'`) per service root holding a `composer.json`, installed
 * with `composer install` (the browser runtime resolves it from Packagist itself). The
 * tables:
 *
 * - `PHP_FRAMEWORKS` — the document root the built-in server serves. Every framework is
 *   served by `php -S 0.0.0.0:8000 -t <docroot>`: the runtime routes a path without an
 *   extension to the nearest `index.php`, so Laravel's and Slim's front controllers need
 *   no router script, and static assets are sent as files. `php artisan serve` is not
 *   used: it starts `php -S` as a child process, and php-wasm has no `proc_open`.
 * - `PHP_MIGRATIONS` — Laravel's `php artisan migrate --force`, Doctrine Migrations.
 *
 * Postgres (a `pgsql` extension required, or a Laravel / `DATABASE_URL` config pointed
 * at Postgres) yields the blueprint's `database`, the same `AppDatabase` the Node ORM
 * detectors emit. php-wasm has no `pdo_pgsql`: the browser runtime supplies
 * `\Bfwc\Pgsql\PDO` (a `\PDO`) for the app to construct instead, and declines a
 * composer.json that REQUIRES `ext-pgsql` / `ext-pdo_pgsql` by name. Detection reports
 * the database either way; whether the browser can run it is the runtime's call.
 */

import type { AppBlueprint, AppDatabase, BlueprintDetector } from '@builderforce/creation-canvas-contract';
import { SERVICE_KINDS } from '@builderforce/creation-canvas-contract';
import {
  detectAcrossServiceRoots,
  devPortOf,
  isPrimaryAt,
  normalizePackageName,
  pathUnder,
  POSTGRES_DATABASE_URL,
  postgresDatabase,
  processService,
  readsUnderServiceRoots,
  serviceIdFor,
  serviceRootFiles,
  type RootDetection,
  type ServiceRootFiles,
} from './serviceRoots';

const PORT = devPortOf(SERVICE_KINDS.PHP);

interface ComposerJson {
  name?: string;
  require?: Record<string, string>;
  'require-dev'?: Record<string, string>;
}

interface PhpProject {
  root: ServiceRootFiles;
  /** Every package and platform requirement (`laravel/framework`, `ext-pdo_pgsql`), normalised. */
  requires: Set<string>;
  framework: string;
}

interface PhpFramework {
  id: string;
  applies(root: ServiceRootFiles, requires: Set<string>): boolean;
  /** The document root `php -S` serves (`.` = the service root). */
  docroot: string;
}

/** Ordered by specificity; the last entry always applies. */
const PHP_FRAMEWORKS: readonly PhpFramework[] = [
  { id: 'laravel', applies: (root, requires) => root.has('artisan') || requires.has('laravel/framework'), docroot: 'public' },
  { id: 'public-front-controller', applies: (root) => root.has('public/index.php'), docroot: 'public' },
  { id: 'plain', applies: () => true, docroot: '.' },
];

function serveCommand(docroot: string): string {
  return docroot === '.' ? `php -S 0.0.0.0:${PORT}` : `php -S 0.0.0.0:${PORT} -t ${docroot}`;
}

interface PhpMigration {
  applies(project: PhpProject): boolean;
  command: string;
  /** Relative to the service root. */
  migrationsPath: string;
}

const PHP_MIGRATIONS: readonly PhpMigration[] = [
  { applies: (p) => p.framework === 'laravel' && p.root.has('artisan'), command: 'php artisan migrate --force', migrationsPath: 'database/migrations' },
  { applies: (p) => p.requires.has('doctrine/migrations'), command: 'php vendor/bin/doctrine-migrations migrate --no-interaction', migrationsPath: 'migrations' },
];

/** Platform requirements that are the Postgres extensions. */
const POSTGRES_EXTENSIONS = ['ext-pgsql', 'ext-pdo-pgsql'];
/** Laravel's `.env.example` choosing Postgres. */
const LARAVEL_PGSQL_ENV = /^\s*DB_CONNECTION\s*=\s*["']?pgsql\b/m;
/** Laravel's `config/database.php` defaulting to Postgres (its `pgsql` connection block alone is boilerplate). */
const LARAVEL_PGSQL_DEFAULT = /['"]default['"]\s*=>\s*env\(\s*['"]DB_CONNECTION['"]\s*,\s*['"]pgsql['"]/;

function usesPostgres(project: PhpProject): boolean {
  if (POSTGRES_EXTENSIONS.some((ext) => project.requires.has(ext))) return true;
  const envExample = project.root.get('.env.example') ?? '';
  return LARAVEL_PGSQL_ENV.test(envExample)
    || POSTGRES_DATABASE_URL.test(envExample)
    || LARAVEL_PGSQL_DEFAULT.test(project.root.get('config/database.php') ?? '');
}

function phpDatabase(project: PhpProject): AppDatabase {
  const migration = PHP_MIGRATIONS.find((m) => m.applies(project));
  // `migrationsPath` is repo-relative, like the Node ORM detectors' (`api/database/migrations`).
  return postgresDatabase(migration?.command ?? '', migration ? pathUnder(project.root.root, migration.migrationsPath) : '');
}

function parseComposer(text: string): ComposerJson | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as ComposerJson) : null;
  } catch {
    return null;
  }
}

/** The service (and database) one root's composer.json describes, or null when it holds none. */
function detectPhpRoot(files: Map<string, string>, rootName: string): RootDetection | null {
  const root = serviceRootFiles(files, rootName);
  const composerText = root.get('composer.json');
  if (composerText === undefined) return null;
  const composer = parseComposer(composerText);
  if (!composer) return null;

  const requires = new Set(
    [...Object.keys(composer.require ?? {}), ...Object.keys(composer['require-dev'] ?? {})].map(normalizePackageName),
  );
  const framework = PHP_FRAMEWORKS.find((f) => f.applies(root, requires))!;
  const project: PhpProject = { root, requires, framework: framework.id };
  const service = processService({
    // `acme/shop` → `shop`.
    id: serviceIdFor(rootName, composer.name?.split('/').pop(), 'php'),
    kind: SERVICE_KINDS.PHP,
    rootDir: root.rootDir,
    packageManager: 'composer',
    installCommand: 'composer install',
    devCommand: serveCommand(framework.docroot),
    isPrimary: isPrimaryAt(files),
  });
  return { service, database: usesPostgres(project) ? phpDatabase(project) : null };
}

/** Detect every PHP service across the service roots. */
export function detectPhp(files: Map<string, string>): Partial<AppBlueprint> {
  return detectAcrossServiceRoots(files, detectPhpRoot);
}

export const phpDetector: BlueprintDetector = {
  id: 'php',
  name: 'PHP Project',
  reads: readsUnderServiceRoots(['composer.json', 'artisan', 'public/index.php', 'config/database.php', '.env.example']),
  detect: detectPhp,
};
