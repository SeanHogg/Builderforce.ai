/**
 * W2: Python detector
 *
 * A Python service (`kind: 'python'`) per service root holding a manifest
 * (requirements.txt, pyproject.toml or Pipfile). Everything it recognises is a table:
 *
 * - `PYTHON_MANIFESTS` — how each manifest names its dependencies and installs them, in
 *   the forms the browser's Python runtime runs (`pip install -r requirements.txt`,
 *   `pip install .` for a pyproject; a Pipfile's packages by name, which micropip installs).
 * - `PYTHON_FRAMEWORKS` — the dev command per framework, as the app-server lines the
 *   runtime serves request-driven: ASGI on `uvicorn module:app`, Flask on `flask --app
 *   module:app run`, Django's WSGI module on `gunicorn project.wsgi:application`
 *   (`manage.py runserver` binds its own socket server, which the runtime does not run).
 * - `PYTHON_MIGRATIONS` — Django's `manage.py migrate`, Alembic (`python -m alembic`, so
 *   the command is Python's, not a Node binary).
 *
 * A Postgres driver (or a `DATABASE_URL` library pointed at Postgres) yields the
 * blueprint's `database`, the same `AppDatabase` the Node ORM detectors emit: the run
 * target then starts the database and its migration before every backend. Drivers the
 * browser cannot load (`psycopg2`, `asyncpg`) are still detected — the runtime declines
 * them by name, which is the honest answer; `pg8000` runs there unmodified.
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
import { tomlString, tomlStringArrays, tomlTable } from './minimalToml';

const PORT = devPortOf(SERVICE_KINDS.PYTHON);

/** The distribution a requirement line names: `fastapi[all]>=0.110 ; python_version>"3"` → `fastapi`. */
function requirementName(spec: string): string | null {
  const name = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec)?.[1];
  return name ? normalizePackageName(name) : null;
}

const names = (specs: Iterable<string>): string[] => [...specs].map(requirementName).filter((n): n is string => n !== null);

// ── Manifests ──

interface PythonManifest {
  file: string;
  /** The distributions it depends on (normalised). */
  dependencies(text: string): string[];
  /** The project's name, when the manifest carries one. */
  projectName(text: string): string | undefined;
  /** How the browser's Python runtime installs it ('' = nothing to install). */
  install(text: string): string;
}

/** Ordered by preference: the first manifest present supplies the install command. */
const PYTHON_MANIFESTS: readonly PythonManifest[] = [
  {
    file: 'requirements.txt',
    dependencies: (text) => names(text.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter((l) => l && !l.startsWith('-'))),
    projectName: () => undefined,
    install: () => 'pip install -r requirements.txt',
  },
  {
    file: 'pyproject.toml',
    dependencies: (text) => [
      ...names(tomlStringArrays(text, 'dependencies')),
      ...names([...tomlTable(text, 'tool.poetry.dependencies').keys()].filter((k) => k !== 'python')),
    ],
    projectName: (text) => {
      const name = tomlTable(text, 'project').get('name') ?? tomlTable(text, 'tool.poetry').get('name');
      return tomlString(name);
    },
    install: () => 'pip install .',
  },
  {
    file: 'Pipfile',
    dependencies: (text) => names(tomlTable(text, 'packages').keys()),
    projectName: () => undefined,
    // pipenv is not in the browser; its packages are, by name.
    install: (text) => {
      const packages = [...tomlTable(text, 'packages').keys()];
      return packages.length > 0 ? `pip install ${packages.join(' ')}` : '';
    },
  },
];

// ── The project, as the tables below read it ──

interface PythonProject {
  root: ServiceRootFiles;
  dependencies: Set<string>;
  framework: string | null;
}

/** Files the app object may be created in, with the module the server imports. */
const PYTHON_ENTRY_FILES: ReadonlyArray<{ file: string; module: string }> = [
  { file: 'main.py', module: 'main' },
  { file: 'app.py', module: 'app' },
  { file: 'app/main.py', module: 'app.main' },
];

/** `module:attribute` of the first entry file assigning one of `constructors` (`app = FastAPI(`). */
function appTarget(root: ServiceRootFiles, constructors: readonly string[]): string | null {
  const assignment = new RegExp(`^([A-Za-z_]\\w*)\\s*(?::[^=\\n]+)?=\\s*(?:\\w+\\.)*(?:${constructors.join('|')})\\(`, 'm');
  for (const entry of PYTHON_ENTRY_FILES) {
    const attribute = assignment.exec(root.get(entry.file) ?? '')?.[1];
    if (attribute) return `${entry.module}:${attribute}`;
  }
  return null;
}

/** `os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mysite.settings')` → `mysite`. */
function djangoProject(managePy: string | undefined): string | null {
  return /DJANGO_SETTINGS_MODULE['"]\s*,\s*['"]([\w.]+)\.settings['"]/.exec(managePy ?? '')?.[1] ?? null;
}

interface PythonFramework {
  id: string;
  /** Distributions that name the framework. */
  dependencies: readonly string[];
  /** The dev command, or null when the project does not say enough to serve it. */
  devCommand(root: ServiceRootFiles): string | null;
}

/** Ordered by specificity: a Django app that also lists Starlette is a Django app. */
const PYTHON_FRAMEWORKS: readonly PythonFramework[] = [
  {
    id: 'django',
    dependencies: ['django'],
    devCommand: (root) => {
      const project = djangoProject(root.get('manage.py'));
      return project ? `gunicorn ${project}.wsgi:application --bind 0.0.0.0:${PORT}` : null;
    },
  },
  {
    id: 'asgi',
    dependencies: ['fastapi', 'starlette'],
    devCommand: (root) => `uvicorn ${appTarget(root, ['FastAPI', 'Starlette']) ?? 'main:app'} --host 0.0.0.0 --port ${PORT}`,
  },
  {
    id: 'flask',
    dependencies: ['flask'],
    devCommand: (root) => `flask --app ${appTarget(root, ['Flask']) ?? 'app:app'} run --host 0.0.0.0 --port ${PORT}`,
  },
];

/** A project with no framework the table knows runs its entry script, when it has one. */
function scriptCommand(root: ServiceRootFiles): string | null {
  const entry = PYTHON_ENTRY_FILES.find((e) => root.has(e.file));
  return entry ? `python ${entry.file}` : null;
}

interface PythonMigration {
  applies(project: PythonProject): boolean;
  command: string;
  /** Relative to the service root ('' = none to name). */
  migrationsPath(project: PythonProject): string;
}

const PYTHON_MIGRATIONS: readonly PythonMigration[] = [
  {
    applies: (p) => p.framework === 'django' && p.root.has('manage.py'),
    command: 'python manage.py migrate',
    migrationsPath: () => '',
  },
  {
    applies: (p) => p.root.has('alembic.ini') || p.dependencies.has('alembic'),
    command: 'python -m alembic upgrade head',
    migrationsPath: (p) => (/^\s*script_location\s*=\s*(\S+)/m.exec(p.root.get('alembic.ini') ?? '')?.[1] ?? 'alembic').replace(/^\.\//, ''),
  },
];

/** Drivers that speak Postgres themselves. */
const POSTGRES_DRIVERS = new Set(['psycopg', 'psycopg-binary', 'psycopg2', 'psycopg2-binary', 'asyncpg', 'pg8000']);
/** Libraries that connect wherever `DATABASE_URL` points — Postgres when the project says so. */
const DATABASE_URL_LIBRARIES = new Set(['sqlalchemy', 'sqlmodel', 'django', 'dj-database-url', 'databases', 'tortoise-orm', 'peewee']);
const POSTGRES_URL_IN_CODE = /postgres(?:ql)?(?:\+\w+)?:\/\//;

function usesPostgres(project: PythonProject): boolean {
  const deps = [...project.dependencies];
  if (deps.some((d) => POSTGRES_DRIVERS.has(d))) return true;
  if (!deps.some((d) => DATABASE_URL_LIBRARIES.has(d))) return false;
  if (POSTGRES_DATABASE_URL.test(project.root.get('.env.example') ?? '')) return true;
  return PYTHON_ENTRY_FILES.some((e) => POSTGRES_URL_IN_CODE.test(project.root.get(e.file) ?? ''));
}

function pythonDatabase(project: PythonProject): AppDatabase {
  const migration = PYTHON_MIGRATIONS.find((m) => m.applies(project));
  const migrationsPath = migration?.migrationsPath(project) ?? '';
  // `migrationsPath` is repo-relative, like the Node ORM detectors' (`api/migrations`).
  return postgresDatabase(migration?.command ?? '', migrationsPath ? pathUnder(project.root.root, migrationsPath) : '');
}

/** The service (and database) one root's manifests describe, or null when it holds none / nothing runnable. */
function detectPythonRoot(files: Map<string, string>, rootName: string): RootDetection | null {
  const root = serviceRootFiles(files, rootName);
  const present = PYTHON_MANIFESTS.filter((m) => root.has(m.file));
  if (present.length === 0) return null;

  const dependencies = new Set(present.flatMap((m) => m.dependencies(root.get(m.file)!)));
  const framework = PYTHON_FRAMEWORKS.find((f) => f.dependencies.some((d) => dependencies.has(d)) && f.devCommand(root) !== null);
  const devCommand = framework?.devCommand(root) ?? scriptCommand(root);
  // A manifest with nothing to serve (docs tooling, a lint venv) is not a service.
  if (!devCommand) return null;

  const project: PythonProject = { root, dependencies, framework: framework?.id ?? null };
  const projectName = present.map((m) => m.projectName(root.get(m.file)!)).find((n) => n);
  const service = processService({
    id: serviceIdFor(rootName, projectName, 'python'),
    kind: SERVICE_KINDS.PYTHON,
    rootDir: root.rootDir,
    packageManager: 'pip',
    installCommand: present[0]!.install(root.get(present[0]!.file)!),
    devCommand,
    isPrimary: isPrimaryAt(files),
  });
  return { service, database: usesPostgres(project) ? pythonDatabase(project) : null };
}

/** Detect every Python service across the service roots. */
export function detectPython(files: Map<string, string>): Partial<AppBlueprint> {
  return detectAcrossServiceRoots(files, detectPythonRoot);
}

export const pythonDetector: BlueprintDetector = {
  id: 'python',
  name: 'Python Project',
  reads: readsUnderServiceRoots([
    ...PYTHON_MANIFESTS.map((m) => m.file),
    ...PYTHON_ENTRY_FILES.map((e) => e.file),
    'manage.py',
    'alembic.ini',
    '.env.example',
  ]),
  detect: detectPython,
};
