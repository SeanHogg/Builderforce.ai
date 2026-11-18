import { describe, expect, it } from 'vitest';
import { validateSpec } from '@seanhogg/builderforce-webcontainers/app';
import { acceptanceProbe, blueprintToApplicationSpec, commandOf, runtimeRoot } from './blueprintToApplicationSpec';
import { acceptBlueprintInBrowser } from './browserAcceptance';
import { blueprint, CANVAS_APP, HIRED_VIDEO, service } from './blueprintFixtures';

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

  it('declines services that cannot start together (two on one port)', () => {
    const clash = blueprint({
      services: [
        service({ id: 'a', kind: 'node', devCommand: 'node a.js', ports: [3000] }),
        service({ id: 'b', kind: 'node', devCommand: 'node b.js', ports: [3000] }),
      ],
    });
    expect(acceptBlueprintInBrowser(clash)).toMatchObject({ ok: false, code: 'invalidSpec' });
  });
});
