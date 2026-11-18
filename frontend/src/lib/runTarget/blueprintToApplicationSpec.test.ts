import { describe, expect, it } from 'vitest';
import { validateSpec } from '@seanhogg/builderforce-webcontainers/app';
import { VirtualFileSystem } from '@seanhogg/builderforce-webcontainers';
import { acceptanceProbe, blueprintToApplicationSpec, commandOf, commandRuntime, movedCommand, runtimeRoot } from './blueprintToApplicationSpec';
import { acceptBlueprintInBrowser } from './browserAcceptance';
import { blueprint, CANVAS_APP, HIRED_VIDEO, PHP_APP, PYTHON_APP, service } from './blueprintFixtures';

const byId = (spec: ReturnType<typeof blueprintToApplicationSpec>, id: string) => spec.services.find((s) => s.id === id);

describe('commandOf', () => {
  it('runs package runners as they are', () => {
    expect(commandOf('npm run dev')).toEqual({ command: 'npm', args: ['run', 'dev'] });
    expect(commandOf('node server.js')).toEqual({ command: 'node', args: ['server.js'] });
  });

  it('runs a bare package binary (a script body) through npx', () => {
    expect(commandOf('vite --port 5173')).toEqual({ command: 'npx', args: ['vite', '--port', '5173'] });
  });

  it('keeps quoted words whole', () => {
    expect(commandOf('node -e "console.log(1)"')).toEqual({ command: 'node', args: ['-e', 'console.log(1)'] });
  });

  it('hands shell syntax to the shell', () => {
    expect(commandOf('npx drizzle-kit push && node migrate.mjs')).toEqual({
      command: 'bfsh', args: ['-c', 'npx drizzle-kit push && node migrate.mjs'],
    });
  });

  it('hands an env-prefixed command and a bare & to the shell', () => {
    expect(commandOf('NODE_ENV=development node server.js')).toEqual({ command: 'bfsh', args: ['-c', 'NODE_ENV=development node server.js'] });
    expect(commandOf('vite & node api.js')).toEqual({ command: 'bfsh', args: ['-c', 'vite & node api.js'] });
  });

  it('has nothing to run for an empty command', () => {
    expect(commandOf('  ')).toBeNull();
  });

  it.each([
    ['python app.py', 'python', ['app.py']],
    ['uvicorn main:app --port 8000', 'uvicorn', ['main:app', '--port', '8000']],
    ['pip install -r requirements.txt', 'pip', ['install', '-r', 'requirements.txt']],
    ['flask run -p 5000', 'flask', ['run', '-p', '5000']],
    ['php -S 0.0.0.0:8000 -t public', 'php', ['-S', '0.0.0.0:8000', '-t', 'public']],
    ['composer install', 'composer', ['install']],
  ])('runs the Python/PHP command %s as it is, never through npx', (line, command, args) => {
    expect(commandOf(line)).toEqual({ command, args });
  });
});

describe('commandRuntime', () => {
  it.each([
    ['node', 'node'], ['npm', 'node'], ['npx', 'node'], ['bfsh', 'node'],
    ['python', 'python'], ['python3', 'python'], ['pip', 'python'], ['uvicorn', 'python'], ['gunicorn', 'python'], ['flask', 'python'],
    ['php', 'php'], ['composer', 'php'],
    ['dotnet', 'dotnet'], ['cargo', 'rust'], ['./target/wasm32-wasip1/release/edge.wasm', 'rust'],
  ])('%s runs on %s', (command, runtime) => {
    expect(commandRuntime(command)).toBe(runtime);
  });
});

describe('runtimeRoot', () => {
  it('maps a repo-relative root onto the project tree', () => {
    expect(runtimeRoot('.')).toBe('/');
    expect(runtimeRoot('')).toBe('/');
    expect(runtimeRoot('frontend')).toBe('/frontend');
    expect(runtimeRoot('./api/')).toBe('/api');
    expect(runtimeRoot('apps\\web')).toBe('/apps/web');
  });
});

describe('blueprintToApplicationSpec — a canvas app (Vite + Express + Postgres)', () => {
  const spec = blueprintToApplicationSpec(CANVAS_APP);

  it('is a valid application spec for the project', () => {
    expect(spec.projectId).toBe('7');
    expect(validateSpec(spec)).toEqual([]);
  });

  it('starts installs, then the database and its migration, then the services', () => {
    expect(spec.services.map((s) => s.id)).toEqual(['web-install', 'api-install', 'db', 'db-migrate', 'web', 'api']);
  });

  it('maps a Postgres database to a persistent PGlite database', () => {
    expect(byId(spec, 'db')).toEqual({
      id: 'db', type: 'database', runtime: 'pglite', port: 5432, readiness: { kind: 'query' },
      database: { engine: 'postgres', provider: 'pglite', persistent: true },
    });
  });

  it('runs the migration as a one-off step in the API root, after the database', () => {
    expect(byId(spec, 'db-migrate')).toMatchObject({
      type: 'application', runtime: 'node', root: '/api', command: 'npm', args: ['run', 'migrate'],
      readiness: { kind: 'exit-zero' }, restartPolicy: 'never', dependsOn: ['db', 'api-install'],
    });
  });

  it('starts the API on a migrated database, held to its own readiness', () => {
    expect(byId(spec, 'api')).toMatchObject({
      role: 'backend', root: '/api', command: 'node', args: ['server.js'], port: 8000,
      readiness: { kind: 'http', path: '/health' }, restartPolicy: 'on-failure',
      dependsOn: ['api-install', 'db', 'db-migrate'],
    });
  });

  it('starts the frontend after the API and never on the database (so no DATABASE_URL)', () => {
    const web = byId(spec, 'web');
    expect(web).toMatchObject({ role: 'frontend', root: '/web', port: 5173, readiness: { kind: 'port' }, dependsOn: ['web-install', 'api'] });
    expect(web?.dependsOn).not.toContain('db');
    expect(web?.dependsOn).not.toContain('db-migrate');
  });

  it('passes only the vars that have a default as app-wide env', () => {
    expect(spec.env).toEqual({ API_PREFIX: '/api' });
  });

  it('is accepted by the browser runtime', () => {
    expect(acceptBlueprintInBrowser(CANVAS_APP)).toMatchObject({ ok: true });
  });
});

describe('blueprintToApplicationSpec — the hired.video shape', () => {
  const spec = blueprintToApplicationSpec(HIRED_VIDEO);

  it('turns package names into runtime ids and keeps the dependency edges on them', () => {
    expect(spec.services.map((s) => s.id)).toEqual([
      'hired-api-install', 'frontend-install', 'db', 'db-migrate', 'db-seed', 'hired-api', 'frontend',
    ]);
    expect(byId(spec, 'frontend')?.dependsOn).toEqual(['frontend-install', 'hired-api']);
  });

  it('maps Neon to PGlite, and runs the seed after the migration', () => {
    expect(byId(spec, 'db')?.database).toEqual({ engine: 'postgres', provider: 'pglite', persistent: true });
    expect(byId(spec, 'db-migrate')).toMatchObject({ command: 'bfsh', args: ['-c', 'npx drizzle-kit push && node scripts/run-sql-migrations.mjs'] });
    expect(byId(spec, 'db-seed')).toMatchObject({ dependsOn: ['db', 'hired-api-install', 'db-migrate'], readiness: { kind: 'exit-zero' } });
    expect(byId(spec, 'hired-api')?.dependsOn).toEqual(['hired-api-install', 'db', 'db-migrate', 'db-seed']);
  });

  it('DECLINES to the container: wrangler dev needs Miniflare', () => {
    const verdict = acceptBlueprintInBrowser(HIRED_VIDEO);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.code).toBe('serviceDeclined');
    expect(verdict.detail).toMatch(/wrangler/i);
    expect(verdict.detail).toMatch(/Miniflare|workerd/);
  });
});

/** A project tree the runtime's own file checks read (requirements.txt, composer.json). */
function projectFiles(files: Record<string, string>): VirtualFileSystem {
  const fs = new VirtualFileSystem();
  fs.writeTree(files);
  return fs;
}

/** A language app's expected mapping. */
interface LanguageRow {
  name: string;
  app: typeof PYTHON_APP;
  runtime: string;
  order: string[];
  install: { command: string; args: string[] };
  migrate: { command: string; args: string[] };
  api: Record<string, unknown>;
  files: Record<string, string>;
}

describe.each<LanguageRow>([
  {
    name: 'a Python app (FastAPI on uvicorn)', app: PYTHON_APP, runtime: 'python',
    order: ['web-install', 'api-install', 'db', 'db-migrate', 'web', 'api'],
    install: { command: 'pip', args: ['install', '-r', 'requirements.txt'] },
    migrate: { command: 'python', args: ['-m', 'alembic', 'upgrade', 'head'] },
    api: { command: 'uvicorn', args: ['main:app', '--port', '8000'], port: 8000, readiness: { kind: 'http', path: '/health' } },
    files: { 'api/requirements.txt': 'fastapi\npg8000\n', 'api/main.py': 'app = None\n' },
  },
  {
    name: 'a PHP app (php -S + Composer)', app: PHP_APP, runtime: 'php',
    order: ['api-install', 'db', 'db-migrate', 'api'],
    install: { command: 'composer', args: ['install'] },
    migrate: { command: 'php', args: ['migrate.php'] },
    api: { command: 'php', args: ['-S', '0.0.0.0:8000', '-t', 'public', 'public/index.php'], port: 8000, readiness: { kind: 'port' } },
    files: { 'api/composer.json': '{"require":{"php":">=8.1","slim/slim":"^4.0"}}', 'api/public/index.php': '<?php echo 1;' },
  },
])('blueprintToApplicationSpec — $name', ({ app, runtime, order, install, migrate, api, files }) => {
  const spec = blueprintToApplicationSpec(app);

  it('is a valid application spec, in the same order as a Node app', () => {
    expect(validateSpec(spec)).toEqual([]);
    expect(spec.services.map((s) => s.id)).toEqual(order);
  });

  it('runs the install, the migration and the API on the language runtime', () => {
    expect(byId(spec, 'api-install')).toMatchObject({ runtime, root: '/api', ...install, readiness: { kind: 'exit-zero' } });
    expect(byId(spec, 'db-migrate')).toMatchObject({ runtime, root: '/api', ...migrate, dependsOn: ['db', 'api-install'] });
    expect(byId(spec, 'api')).toMatchObject({ runtime, role: 'backend', root: '/api', ...api, dependsOn: ['api-install', 'db', 'db-migrate'] });
  });

  it('keeps the database on PGlite', () => {
    expect(byId(spec, 'db')).toMatchObject({ runtime: 'pglite', database: { engine: 'postgres', provider: 'pglite', persistent: true } });
  });

  it('is accepted by the browser runtime, with and without the project files', () => {
    expect(acceptBlueprintInBrowser(app)).toMatchObject({ ok: true });
    expect(acceptBlueprintInBrowser(app, projectFiles(files))).toMatchObject({ ok: true });
  });
});

/** Laravel's root package.json (Vite) beside composer.json + artisan; a Flask app beside a root package.json. */
describe.each<{ name: string; app: ReturnType<typeof blueprint>; backend: string; runtime: string; install: { command: string; args: string[] }; migrate: { command: string; args: string[] } | null }>([
  {
    name: 'Laravel at the root (package.json + composer.json + artisan)',
    app: blueprint({
      services: [
        service({ id: 'main', kind: 'vite-react', devCommand: 'vite', ports: [5173], isPrimary: true }),
        service({ id: 'php', kind: 'php', installCommand: 'composer install', devCommand: 'php -S 0.0.0.0:8000 -t public', ports: [8000] }),
      ],
      database: { engine: 'postgres', migrationCommand: 'php artisan migrate --force', seedCommand: null, migrationsPath: 'database/migrations', connectionSecretName: 'DATABASE_URL' },
    }),
    backend: 'php', runtime: 'php',
    install: { command: 'composer', args: ['install'] },
    migrate: { command: 'php', args: ['artisan', 'migrate', '--force'] },
  },
  {
    name: 'Flask at the root beside a package.json',
    app: blueprint({
      services: [
        service({ id: 'web', kind: 'vite-react', devCommand: 'vite', ports: [5173], isPrimary: true }),
        service({ id: 'python', kind: 'python', installCommand: 'pip install -r requirements.txt', devCommand: 'flask --app app:app run --host 0.0.0.0 --port 8000', ports: [8000] }),
      ],
    }),
    backend: 'python', runtime: 'python',
    install: { command: 'pip', args: ['install', '-r', 'requirements.txt'] },
    migrate: null,
  },
])('blueprintToApplicationSpec — $name', ({ app, backend, runtime, install, migrate }) => {
  const spec = blueprintToApplicationSpec(app);
  const frontend = app.services[0]!.id;

  it('installs with BOTH npm and the language package manager in the one root', () => {
    expect(validateSpec(spec)).toEqual([]);
    expect(byId(spec, `${frontend}-install`)).toMatchObject({ runtime: 'node', root: '/', command: 'npm', args: ['install'] });
    expect(byId(spec, `${backend}-install`)).toMatchObject({ runtime, root: '/', ...install });
  });

  it('starts each service after its own runtime’s install', () => {
    expect(byId(spec, backend)).toMatchObject({ runtime, root: '/' });
    expect(byId(spec, backend)?.dependsOn).toContain(`${backend}-install`);
    expect(byId(spec, backend)?.dependsOn).not.toContain(`${frontend}-install`);
    expect(byId(spec, frontend)?.dependsOn).toEqual([`${frontend}-install`, backend]);
  });

  it('runs the migration after its command’s runtime install', () => {
    if (!migrate) {
      expect(byId(spec, 'db-migrate')).toBeUndefined();
      return;
    }
    expect(byId(spec, 'db-migrate')).toMatchObject({ runtime, root: '/', ...migrate, dependsOn: ['db', `${backend}-install`] });
    expect(byId(spec, backend)?.dependsOn).toEqual([`${backend}-install`, 'db', 'db-migrate']);
  });
});

describe('blueprintToApplicationSpec — a Python or PHP service behind the shell', () => {
  it('runs a shelled Python line on node: the shell hands python to its runtime itself', () => {
    const shelled = blueprint({ services: [service({ id: 'api', kind: 'python', installCommand: '', devCommand: 'pip install -r requirements.txt && python app.py', ports: [8000] })] });
    const spec = blueprintToApplicationSpec(shelled);
    expect(byId(spec, 'api')).toMatchObject({ runtime: 'node', command: 'bfsh', args: ['-c', 'pip install -r requirements.txt && python app.py'] });
    expect(acceptBlueprintInBrowser(shelled)).toMatchObject({ ok: true });
  });

  it('judges a shelled Python line on the project files too: psycopg2 declines, by name', () => {
    const shelled = blueprint({ services: [service({ id: 'api', kind: 'python', installCommand: '', devCommand: 'pip install -r requirements.txt && python app.py', ports: [8000] })] });
    expect(acceptBlueprintInBrowser(shelled, projectFiles({ 'requirements.txt': 'flask\n', 'app.py': 'app = None\n' }))).toMatchObject({ ok: true });
    const verdict = acceptBlueprintInBrowser(shelled, projectFiles({ 'requirements.txt': 'flask\npsycopg2\n', 'app.py': 'app = None\n' }));
    expect(verdict).toMatchObject({ ok: false, code: 'serviceDeclined' });
    if (!verdict.ok) expect(verdict.detail).toMatch(/psycopg2/);
  });

  it('keeps a Worker on workerd whatever language its command is in', () => {
    const worker = blueprint({ services: [service({ id: 'edge', kind: 'worker', devCommand: 'python worker.py', ports: [8787] })] });
    expect(blueprintToApplicationSpec(worker).services.at(-1)?.runtime).toBe('workerd');
  });

  it.each([
    ['python', 'uvicorn main:app'],
    ['php', 'php -S 0.0.0.0:8000 -t public'],
  ] as const)('falls back to the %s kind’s dev port when none is declared', (kind, devCommand) => {
    const spec = blueprintToApplicationSpec(blueprint({ services: [service({ id: 'api', kind, installCommand: '', devCommand, ports: [] })] }));
    expect(byId(spec, 'api')?.port).toBe(8000);
  });
});

describe('blueprintToApplicationSpec — dev ports, SSR roles, reserved ids', () => {
  it('uses the kind’s dev port when the blueprint carries the detector’s old placeholder list', () => {
    // What package.json detection stored before it knew the framework's port.
    const detected = blueprint({
      services: [service({ id: '@acme/site', kind: 'vite-react', devCommand: 'vite', ports: [3000, 5173, 8787], isPrimary: true })],
    });
    const spec = blueprintToApplicationSpec(detected);
    expect(byId(spec, 'site')).toMatchObject({ port: 5173, command: 'npx', args: ['vite'] });
    expect(acceptBlueprintInBrowser(detected)).toMatchObject({ ok: true });
  });

  it('falls back to each kind’s default port when none is declared', () => {
    const spec = blueprintToApplicationSpec(blueprint({
      services: [
        service({ id: 'docs', kind: 'astro', ports: [] }),
        service({ id: 'site', kind: 'nextjs', ports: [] }),
      ],
    }));
    expect(byId(spec, 'docs')?.port).toBe(4321);
    expect(byId(spec, 'site')?.port).toBe(3000);
  });

  it('treats an SSR framework as a backend: Next + Postgres gets the database', () => {
    const next = blueprint({
      services: [service({ id: 'site', kind: 'nextjs', devCommand: 'next dev', ports: [3000] })],
      database: { engine: 'postgres', migrationCommand: 'npx prisma migrate deploy', seedCommand: null, migrationsPath: 'prisma', connectionSecretName: 'DATABASE_URL' },
    });
    const spec = blueprintToApplicationSpec(next);
    expect(byId(spec, 'site')).toMatchObject({ role: 'backend', dependsOn: ['site-install', 'db', 'db-migrate'] });
    expect(validateSpec(spec)).toEqual([]);
    expect(acceptBlueprintInBrowser(next)).toMatchObject({ ok: true });
  });

  it('keeps the database ids for the database: a service named db is renamed', () => {
    const spec = blueprintToApplicationSpec(blueprint({
      services: [service({ id: 'db', kind: 'node', devCommand: 'node db.js', ports: [9000] })],
      database: { engine: 'postgres', migrationCommand: '', seedCommand: null, migrationsPath: '', connectionSecretName: 'DATABASE_URL' },
    }));
    expect(byId(spec, 'db')?.type).toBe('database');
    expect(byId(spec, 'db-2')).toMatchObject({ type: 'application', port: 9000 });
  });
});

describe('acceptBlueprintInBrowser — declines with the reason', () => {
  it('declines when no blueprint has been detected', () => {
    expect(acceptBlueprintInBrowser(null)).toEqual({ ok: false, code: 'noBlueprint' });
    expect(acceptBlueprintInBrowser(blueprint())).toEqual({ ok: false, code: 'noBlueprint' });
  });

  it('declines a database PGlite cannot stand in for, naming the engine', () => {
    const mysql = blueprint({
      services: [service({ id: 'api', kind: 'node', devCommand: 'node server.js', ports: [8000] })],
      database: { engine: 'mysql', migrationCommand: '', seedCommand: null, migrationsPath: '', connectionSecretName: 'DATABASE_URL' },
    });
    const verdict = acceptBlueprintInBrowser(mysql);
    expect(verdict).toMatchObject({ ok: false, code: 'databaseDeclined' });
    if (!verdict.ok) expect(verdict.detail).toMatch(/mysql/);
  });

  it('declines a Docker service in the runtime’s own words: no browser runtime runs it', () => {
    const docker = blueprint({ services: [service({ id: 'svc', kind: 'container', devCommand: 'docker compose up' })] });
    expect(acceptBlueprintInBrowser(docker)).toEqual({ ok: false, code: 'serviceDeclined', detail: 'svc: Docker cannot run in the browser runtime.' });
  });

  it('declines a Worker by its kind, whatever its command says', () => {
    const worker = blueprint({ services: [service({ id: 'edge', kind: 'worker', devCommand: 'npm run dev', ports: [8787] })] });
    const verdict = acceptBlueprintInBrowser(worker);
    expect(verdict).toMatchObject({ ok: false, code: 'serviceDeclined' });
    if (!verdict.ok) expect(verdict.detail).toMatch(/^edge: .*workerd/);
  });

  it('declines a database the blueprint pins to a Neon branch', () => {
    const pinned = blueprint({
      services: [service({ id: 'api', kind: 'node', devCommand: 'node server.js', ports: [8000] })],
      database: { engine: 'neon', provider: 'neon-branch', migrationCommand: '', seedCommand: null, migrationsPath: '', connectionSecretName: 'DATABASE_URL' },
    });
    const verdict = acceptBlueprintInBrowser(pinned);
    expect(verdict).toMatchObject({ ok: false, code: 'databaseDeclined' });
    if (!verdict.ok) expect(verdict.detail).toMatch(/neon-branch/);
  });

  it('judges a shell command by the words inside it', () => {
    const shelled = blueprint({ services: [service({ id: 'api', kind: 'node', devCommand: 'cd api && wrangler dev', ports: [8787] })] });
    const spec = blueprintToApplicationSpec(shelled);
    expect(acceptanceProbe(spec.services[1]!).args).toEqual(['cd', 'api', '&&', 'wrangler', 'dev']);
    expect(acceptBlueprintInBrowser(shelled)).toMatchObject({ ok: false, code: 'serviceDeclined' });
  });

  it.each<{ what: string; app: typeof PYTHON_APP; files: Record<string, string>; named: RegExp }>([
    {
      what: 'a Python requirement with no browser wheel (psycopg2), by name', app: PYTHON_APP,
      files: { 'api/requirements.txt': 'fastapi\npsycopg2==2.9.9\n' }, named: /psycopg2/,
    },
    {
      what: 'a Composer requirement php-wasm lacks (ext-pgsql), by name', app: PHP_APP,
      files: { 'api/composer.json': '{"require":{"ext-pgsql":"*"}}' }, named: /pgsql/,
    },
  ])('declines $what — judged on the project files', ({ app, files, named }) => {
    expect(acceptBlueprintInBrowser(app)).toMatchObject({ ok: true });
    const verdict = acceptBlueprintInBrowser(app, projectFiles(files));
    expect(verdict).toMatchObject({ ok: false, code: 'serviceDeclined' });
    if (!verdict.ok) expect(verdict.detail).toMatch(named);
  });

  it.each([
    ['interactive Python (no script)', 'python', 'python'],
    ['interactive PHP', 'php', 'php -a'],
  ] as const)('declines %s in the runtime’s own words', (_what, kind, devCommand) => {
    const verdict = acceptBlueprintInBrowser(blueprint({ services: [service({ id: 'api', kind, installCommand: '', devCommand, ports: [8000] })] }));
    expect(verdict).toMatchObject({ ok: false, code: 'serviceDeclined' });
    if (!verdict.ok) expect(verdict.detail).toMatch(/^Service "api"/);
  });

  it('moves the later of two services on one port to the next free one: they start together', () => {
    const clash = blueprint({
      services: [
        service({ id: 'a', kind: 'node', devCommand: 'node a.js', ports: [3000] }),
        service({ id: 'b', kind: 'node', devCommand: 'node b.js', ports: [3000] }),
      ],
    });
    const spec = blueprintToApplicationSpec(clash);
    expect(byId(spec, 'a')?.port).toBe(3000);
    // `node b.js` names no port: it reads `PORT`, which the runtime sets from the spec.
    expect(byId(spec, 'b')).toMatchObject({ port: 3001, command: 'node', args: ['b.js'] });
    expect(acceptBlueprintInBrowser(clash)).toMatchObject({ ok: true });
  });
});

describe('blueprintToApplicationSpec — same-family backends sharing a default port', () => {
  it.each([
    {
      what: 'a Python and a PHP API (both 8000)',
      first: service({ id: 'py', kind: 'python', rootDir: 'py', installCommand: '', devCommand: 'uvicorn main:app --host 0.0.0.0 --port 8000', ports: [8000] }),
      second: service({ id: 'site', kind: 'php', rootDir: 'site', installCommand: '', devCommand: 'php -S 0.0.0.0:8000 -t public', ports: [8000] }),
      moved: { port: 8001, command: 'php', args: ['-S', '0.0.0.0:8001', '-t', 'public'] },
    },
    {
      what: 'a .NET and a Rust service (both 8080)',
      first: service({ id: 'shop', kind: 'dotnet', rootDir: 'shop', installCommand: '', devCommand: 'dotnet run --urls http://0.0.0.0:8080', ports: [8080] }),
      second: service({ id: 'edge', kind: 'rust', rootDir: 'edge', installCommand: '', devCommand: './target/wasm32-wasip1/release/edge.wasm', ports: [8080] }),
      // The module names no port: it reads `PORT`.
      moved: { port: 8081, command: './target/wasm32-wasip1/release/edge.wasm', args: [] },
    },
    {
      what: 'two Python APIs (both 8000)',
      first: service({ id: 'a', kind: 'python', rootDir: 'a', installCommand: '', devCommand: 'uvicorn main:app --port 8000', ports: [8000] }),
      second: service({ id: 'b', kind: 'python', rootDir: 'b', installCommand: '', devCommand: 'gunicorn site.wsgi:application --bind 0.0.0.0:8000', ports: [8000] }),
      moved: { port: 8001, command: 'gunicorn', args: ['site.wsgi:application', '--bind', '0.0.0.0:8001'] },
    },
  ])('gives each its own port, the later one’s command moved with it: $what', ({ first, second, moved }) => {
    const spec = blueprintToApplicationSpec(blueprint({ services: [first, second] }));
    expect(byId(spec, first.id)?.port).toBe(first.ports[0]);
    expect(byId(spec, second.id)).toMatchObject(moved);
    expect(validateSpec(spec)).toEqual([]);
  });

  it('never moves a service onto the database port', () => {
    const spec = blueprintToApplicationSpec(blueprint({
      services: [service({ id: 'api', kind: 'node', devCommand: 'node server.js --port=5432', ports: [5432] })],
      database: { engine: 'postgres', migrationCommand: '', seedCommand: null, migrationsPath: '', connectionSecretName: 'DATABASE_URL' },
    }));
    expect(byId(spec, 'db')?.port).toBe(5432);
    expect(byId(spec, 'api')).toMatchObject({ port: 5433, args: ['server.js', '--port=5433'] });
  });
});

describe('movedCommand', () => {
  it('moves the port where the command names it, never inside another number', () => {
    expect(movedCommand('uvicorn main:app --port 8000', 8000, 8001)).toBe('uvicorn main:app --port 8001');
    expect(movedCommand('php -S 0.0.0.0:8000 -t public', 8000, 8001)).toBe('php -S 0.0.0.0:8001 -t public');
    expect(movedCommand('dotnet run --urls http://0.0.0.0:8080', 8080, 8081)).toBe('dotnet run --urls http://0.0.0.0:8081');
    expect(movedCommand('vite --port=5173', 5173, 5174)).toBe('vite --port=5174');
    expect(movedCommand('node app.js 18000 80001', 8000, 8001)).toBe('node app.js 18000 80001');
    expect(movedCommand('node app.js', 3000, 3000)).toBe('node app.js');
  });
});
