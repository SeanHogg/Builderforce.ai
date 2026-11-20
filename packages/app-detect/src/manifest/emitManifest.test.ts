/**
 * `emitManifest` on the run target's blueprint shapes (a canvas app — Vite + Express +
 * Postgres — and hired.video — a wrangler Worker + a Vite SPA + Neon + cron), and the
 * round trip back through `manifestToBlueprintOverrides`.
 */
import type { AppBlueprint, AppService } from '@builderforce/creation-canvas-contract';
import { describe, expect, it } from 'vitest';
import { noteMessages } from '../notes';
import type { ComposeResource, IngressEvidence } from '../types';
import { emitManifest } from './emitManifest';
import { manifestToBlueprintOverrides } from './manifestToBlueprintOverrides';
import { MANIFEST_SCHEMA_URL, type ManifestInput } from './manifestShape';
import { runtimeRoot, safeId } from './serviceRuntime';

function service(overrides: Partial<AppService> & Pick<AppService, 'id' | 'kind'>): AppService {
  return {
    rootDir: '.', packageManager: 'npm', installCommand: 'npm install', devCommand: 'npm run dev',
    buildCommand: 'npm run build', startCommand: 'npm start', verifyCommand: null, outputDir: 'dist',
    ports: [3000], envVars: [], isPrimary: false, ...overrides,
  };
}

function blueprint(overrides: Partial<AppBlueprint> = {}): AppBlueprint {
  return {
    id: '7-abc', projectId: 7, commitSha: 'abc', detectedAt: new Date(0), services: [], bindings: [],
    database: null, secrets: [], vars: [], domains: [],
    sources: {
      wranglerToml: false, packageJson: true, viteConfig: false, nextConfig: false, expoConfig: false,
      capacitorConfig: false, drizzleConfig: false, prismaSchema: false, dockerfile: false,
      envExample: false, githubWorkflows: false, builderforceJson: false,
    },
    overrides: null, isMonorepo: false, workspaces: [], ...overrides,
  };
}

const CANVAS_APP = blueprint({
  services: [
    service({ id: 'web', kind: 'vite-react', rootDir: 'web', ports: [5173], isPrimary: true }),
    service({ id: 'api', kind: 'node', rootDir: 'api', devCommand: 'node server.js', ports: [8000], readiness: { kind: 'http', path: '/health' } }),
  ],
  database: { engine: 'postgres', migrationCommand: 'npm run migrate', seedCommand: null, migrationsPath: 'api/migrations', connectionSecretName: 'DATABASE_URL' },
  vars: [{ name: 'API_PREFIX', defaultValue: '/api' }, { name: 'NO_DEFAULT' }],
});

const HIRED_VIDEO = blueprint({
  projectId: 99,
  services: [
    service({ id: 'hired-api', kind: 'worker', rootDir: 'api', devCommand: 'npx wrangler dev', startCommand: 'npx wrangler dev', ports: [8787] }),
    service({ id: '@hired/frontend', kind: 'vite-react', rootDir: 'frontend', devCommand: 'vite', ports: [5173], isPrimary: true }),
  ],
  bindings: [
    { name: 'ROOMS', kind: 'durableObject', className: 'RoomDO', required: true },
    { name: 'MEDIA', kind: 'r2', required: true },
    { name: 'CACHE', kind: 'kv', required: true },
    { name: 'CRON', kind: 'cron', cron: '*/5 * * * *', required: true },
  ],
  database: {
    engine: 'neon', migrationCommand: 'npx drizzle-kit push && node scripts/run-sql-migrations.mjs',
    seedCommand: 'node scripts/seed.mjs', migrationsPath: 'api/migrations', connectionSecretName: 'DATABASE_URL',
  },
  secrets: [{ name: 'JWT_SECRET', required: true }],
});

const PYTHON_AND_PHP = blueprint({
  services: [
    service({ id: 'py', kind: 'python', rootDir: 'py', packageManager: 'pip', installCommand: 'pip install -r requirements.txt', devCommand: 'uvicorn main:app', ports: [] }),
    service({ id: 'php', kind: 'php', rootDir: 'php', packageManager: 'composer', installCommand: 'composer install', devCommand: 'php -S 0.0.0.0:8000 -t public', ports: [] }),
    service({ id: 'train', kind: 'training', rootDir: 'ml', packageManager: 'pip', installCommand: 'pip install -r requirements.txt', devCommand: 'python train.py', ports: [] }),
  ],
});

describe('emitManifest — structure', () => {
  it('writes a v1 manifest: schema, version, keyed services on their runtimes, ports, the local environment', () => {
    const { manifest, text } = emitManifest(CANVAS_APP);
    // No ingress: the blueprint alone is no evidence that the backend serves under /api (see "emitManifest — ingress").
    expect(Object.keys(manifest)).toEqual(['$schema', 'version', 'name', 'resources', 'services', 'environments']);
    expect(manifest.$schema).toBe(MANIFEST_SCHEMA_URL);
    expect(manifest.version).toBe(1);
    expect(manifest.environments).toEqual({ local: { target: 'browser', tier: 'non-production', debug: true } });
    expect(manifest.resources).toEqual({ db: { type: 'postgres', persistent: true } });
    expect(Object.keys(manifest.services)).toEqual(['web-install', 'api-install', 'db-migrate', 'web', 'api']);
    expect(manifest.services.web).toEqual({
      runtime: 'node', root: '/web', command: 'npm run dev', port: 5173, role: 'frontend',
      dependsOn: ['web-install', 'api'], env: { API_PREFIX: '/api' },
    });
    expect(manifest.services.api).toEqual({
      runtime: 'node', root: '/api', command: 'node server.js', port: 8000, uses: ['db'],
      dependsOn: ['api-install', 'db-migrate'], readiness: { http: '/health' }, env: { API_PREFIX: '/api' },
    });
    expect(manifest.services['api-install']).toEqual({ runtime: 'node', root: '/api', command: 'npm install', readiness: { exitZero: true }, restart: 'never' });
    expect(manifest.services['db-migrate']).toMatchObject({ command: 'npm run migrate', uses: ['db'], dependsOn: ['api-install'], readiness: { exitZero: true }, restart: 'never' });
    expect(text).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
  });

  it('is deterministic', () => {
    expect(emitManifest(HIRED_VIDEO).text).toBe(emitManifest(HIRED_VIDEO).text);
  });

  it('maps every service id, service reference and resource id to one the runtime accepts', () => {
    const { manifest } = emitManifest(HIRED_VIDEO);
    const idPattern = /^[A-Za-z][A-Za-z0-9_-]*$/;
    const services = Object.keys(manifest.services);
    for (const id of [...services, ...Object.keys(manifest.resources ?? {})]) expect(id).toMatch(idPattern);
    for (const entry of Object.values(manifest.services)) {
      for (const dep of entry.dependsOn ?? []) expect(services).toContain(dep);
      for (const use of entry.uses ?? []) expect(Object.keys(manifest.resources ?? {})).toContain(use);
      expect(entry.command.trim()).not.toBe('');
    }
  });

  it('turns the hired.video shape into a Worker service, a Neon database, an R2 bucket and a cron job', () => {
    const { manifest, notes: coded } = emitManifest(HIRED_VIDEO);
    const notes = noteMessages(coded);
    expect(manifest.name).toBe('frontend');
    expect(manifest.resources).toEqual({ db: { type: 'postgres', persistent: true }, media: { type: 'object-storage' } });
    expect(manifest.services['hired-api']).toMatchObject({ runtime: 'node', port: 8787, uses: ['db', 'media'], dependsOn: ['hired-api-install', 'db-migrate', 'db-seed'] });
    expect(manifest.services.frontend).toMatchObject({ role: 'frontend', dependsOn: ['frontend-install', 'hired-api'] });
    expect(manifest.services.frontend?.uses).toBeUndefined();
    expect(manifest.services['db-seed']).toMatchObject({ dependsOn: ['hired-api-install', 'db-migrate'] });
    expect(manifest.jobs).toEqual({ cron: { schedule: '*/5 * * * *', invoke: { service: 'hired-api', method: 'GET', path: '/__scheduled' } } });
    expect(notes.some((n) => n.includes('/__scheduled') && n.includes('needs a route'))).toBe(true);
    expect(notes.some((n) => n.includes('durableObject binding ROOMS'))).toBe(true);
    expect(notes.some((n) => n.includes('kv binding CACHE'))).toBe(true);
    expect(notes.some((n) => n.includes('neon database'))).toBe(true);
    expect(notes.some((n) => n.includes('JWT_SECRET'))).toBe(true);
  });

  it('maps kinds to runtimes, gives two services on one default port distinct ports, and writes training as a started python service', () => {
    const { manifest, notes: coded } = emitManifest(PYTHON_AND_PHP);
    const notes = noteMessages(coded);
    expect(manifest.services.py).toMatchObject({ runtime: 'python', port: 8000, dependsOn: ['py-install'] });
    expect(manifest.services.php).toMatchObject({ runtime: 'php', port: 8001, dependsOn: ['php-install'] });
    expect(manifest.services.train).toMatchObject({ runtime: 'python', readiness: { started: true }, restart: 'never' });
    expect(manifest.services.train?.port).toBeUndefined();
    expect(manifest.services['php-install']).toMatchObject({ runtime: 'php', command: 'composer install' });
    expect(notes.some((n) => n.includes('"php" also wanted port 8000'))).toBe(true);
  });

  it('declares compose resources, used by the services whose depends_on names them, and folds a compose postgres into db', () => {
    const compose: ComposeResource[] = [
      { id: 'cache', type: 'redis', image: 'redis:7', usedBy: ['api'] },
      { id: 'pg', type: 'postgres', image: 'pgvector/pgvector:pg16', extensions: ['vector'], usedBy: ['api'] },
      { id: 'mail', type: 'mail', image: 'axllent/mailpit', usedBy: ['web'] },
    ];
    const { manifest, notes: coded } = emitManifest(CANVAS_APP, { composeResources: compose, name: 'shop' });
    const notes = noteMessages(coded);
    expect(manifest.name).toBe('shop');
    expect(manifest.resources).toEqual({
      db: { type: 'postgres', persistent: true, extensions: ['vector'] },
      cache: { type: 'redis' },
      mail: { type: 'mail' },
    });
    expect(manifest.services.api?.uses).toEqual(['db', 'cache']);
    expect(manifest.services.web?.uses).toBeUndefined();
    expect(notes.some((n) => n.includes('Frontend "web" never receives credentials'))).toBe(true);
  });

  it('notes a database engine it cannot express', () => {
    const { manifest, notes: coded } = emitManifest(blueprint({
      services: [service({ id: 'api', kind: 'node' })],
      database: { engine: 'mysql', migrationCommand: '', seedCommand: null, migrationsPath: '', connectionSecretName: 'DATABASE_URL' },
    }));
    const notes = noteMessages(coded);
    expect(manifest.resources).toBeUndefined();
    expect(notes).toContain('The mysql database is not expressible in manifest v1 (postgres only), so no database resource was written.');
  });
});

describe('emitManifest — ingress', () => {
  const API_ROUTES: IngressEvidence[] = [{ kind: 'backend-routes', file: 'api/server.js' }];

  it('routes /api to the one HTTP backend and / to the one frontend, longest path first, and notes it', () => {
    const { manifest, notes: codedNotes } = emitManifest(CANVAS_APP, { ingressEvidence: API_ROUTES });
    expect(manifest.ingress).toEqual({ routes: [{ path: '/api', service: 'api' }, { path: '/', service: 'web' }] });
    expect(codedNotes).toContainEqual(expect.objectContaining({ code: 'ingress-api-backend', params: { frontend: 'web', backend: 'api', path: '/api' } }));
  });

  it('routes on an unrewritten dev proxy alone', () => {
    const { manifest } = emitManifest(CANVAS_APP, { ingressEvidence: [{ kind: 'dev-proxy', file: 'web/vite.config.js' }] });
    expect(manifest.ingress?.routes).toEqual([{ path: '/api', service: 'api' }, { path: '/', service: 'web' }]);
  });

  it('writes no ingress without evidence, and says how to add one', () => {
    const { manifest, notes } = emitManifest(CANVAS_APP);
    expect(manifest.ingress).toBeUndefined();
    expect(notes.some((note) => note.code === 'ingress-api-backend')).toBe(false);
    expect(notes).toContainEqual(expect.objectContaining({ code: 'ingress-not-inferred', params: { frontend: 'web', backend: 'api', path: '/api' } }));
    expect(noteMessages(notes).some((n) => n.includes('add an ingress route'))).toBe(true);
  });

  it('writes no ingress when the dev proxy rewrites /api, and names the file', () => {
    const { manifest, notes } = emitManifest(CANVAS_APP, { ingressEvidence: [{ kind: 'proxy-rewrite', file: 'web/vite.config.ts' }] });
    expect(manifest.ingress).toBeUndefined();
    expect(notes).toContainEqual(expect.objectContaining({
      code: 'ingress-proxy-rewrites', params: { frontend: 'web', backend: 'api', path: '/api', file: 'web/vite.config.ts' },
    }));
    expect(notes.some((note) => note.code === 'ingress-not-inferred')).toBe(false);
  });

  it('routes when the backend declares /api routes even though a proxy rewrites', () => {
    const { manifest } = emitManifest(CANVAS_APP, { ingressEvidence: [{ kind: 'proxy-rewrite', file: 'web/vite.config.ts' }, ...API_ROUTES] });
    expect(manifest.ingress?.routes).toHaveLength(2);
  });

  it('writes no ingress for two HTTP backends', () => {
    const { manifest, notes: codedNotes } = emitManifest(blueprint({
      services: [
        service({ id: 'web', kind: 'vite-react', ports: [5173], isPrimary: true }),
        service({ id: 'api', kind: 'node', ports: [8000] }),
        service({ id: 'admin', kind: 'node', ports: [8001] }),
      ],
    }), { ingressEvidence: API_ROUTES });
    expect(manifest.ingress).toBeUndefined();
    expect(codedNotes.some((note) => note.code === 'ingress-api-backend')).toBe(false);
    expect(codedNotes.some((note) => note.code === 'ingress-not-inferred')).toBe(false);
  });

  it('says why when more than one frontend or backend leaves no single ingress', () => {
    const { notes } = emitManifest(blueprint({
      services: [
        service({ id: 'web', kind: 'vite-react', rootDir: 'web', ports: [5173], isPrimary: true }),
        service({ id: 'admin', kind: 'vite-react', rootDir: 'admin', ports: [5174] }),
        service({ id: 'api', kind: 'node', rootDir: 'api', ports: [8000] }),
      ],
    }), { ingressEvidence: API_ROUTES });
    expect(notes).toContainEqual({ code: 'ingress-ambiguous', params: { frontends: ['web', 'admin'], backends: ['api'], path: '/api' } });
    expect(noteMessages(notes).some((n) => n.includes('frontends (web, admin) and backends (api)'))).toBe(true);
  });

  it('counts evidence only from its own service: routes under the backend root, a proxy under the frontend root', () => {
    const outside: IngressEvidence[] = [{ kind: 'backend-routes', file: 'mock/server.js' }, { kind: 'dev-proxy', file: 'api/vite.config.js' }];
    const { manifest, notes } = emitManifest(CANVAS_APP, { ingressEvidence: outside });
    expect(manifest.ingress).toBeUndefined();
    expect(notes.some((note) => note.code === 'ingress-not-inferred')).toBe(true);
    // A rewriting proxy outside the frontend is not counter-evidence either.
    const rewrite = emitManifest(CANVAS_APP, { ingressEvidence: [{ kind: 'proxy-rewrite', file: 'other/vite.config.ts' }] });
    expect(rewrite.notes.some((note) => note.code === 'ingress-proxy-rewrites')).toBe(false);
  });

  it('writes no ingress for a frontend alone', () => {
    const { manifest } = emitManifest(blueprint({ services: [service({ id: 'web', kind: 'vite-react', ports: [5173], isPrimary: true })] }));
    expect(manifest.ingress).toBeUndefined();
    expect(Object.keys(manifest)).not.toContain('ingress');
  });
});

describe('emitManifest → manifestToBlueprintOverrides — round trip', () => {
  for (const [label, bp] of [['canvas app', CANVAS_APP], ['hired.video', HIRED_VIDEO], ['python + php', PYTHON_AND_PHP]] as const) {
    it(`reads back the same services and database (${label})`, () => {
      const { manifest } = emitManifest(bp);
      const back = manifestToBlueprintOverrides(manifest as ManifestInput).overrides;
      const taken = new Set(['db', 'db-migrate', 'db-seed']);
      const expected = bp.services.map((s) => ({
        id: safeId(s.id, taken),
        root: runtimeRoot(s.rootDir),
        devCommand: s.devCommand,
        installCommand: s.installCommand,
        readiness: s.readiness,
      }));
      expect(back.services?.map((s) => ({
        id: s.id, root: runtimeRoot(s.rootDir), devCommand: s.devCommand, installCommand: s.installCommand, readiness: s.readiness,
      }))).toEqual(expected);
      expect(back.services?.map((s) => s.ports)).toEqual(Object.values(manifest.services)
        .filter((entry) => !entry.readiness || !('exitZero' in entry.readiness))
        .map((entry) => (entry.port === undefined ? [] : [entry.port])));
      expect(back.services?.find((s) => s.isPrimary)?.id).toBe(safeId(bp.services.find((s) => s.isPrimary)?.id ?? bp.services[0]!.id, new Set()));
      if (bp.database) {
        expect(back.database).toMatchObject({ engine: 'postgres', migrationCommand: bp.database.migrationCommand, seedCommand: bp.database.seedCommand });
      } else {
        expect(back.database).toBeUndefined();
      }
    });
  }

  it('re-emits the read-back blueprint as the same services', () => {
    const first = emitManifest(CANVAS_APP).manifest;
    const back = manifestToBlueprintOverrides(first as ManifestInput).overrides;
    const again = emitManifest({ ...CANVAS_APP, ...back }).manifest;
    expect(again.services).toEqual(first.services);
    expect(again.resources).toEqual(first.resources);
  });

  it('notes the ingress it reads back, which has no blueprint field (as it does jobs)', () => {
    const { manifest } = emitManifest(CANVAS_APP, { ingressEvidence: [{ kind: 'backend-routes', file: 'api/server.js' }] });
    const { notes } = manifestToBlueprintOverrides(manifest as ManifestInput);
    expect(notes).toContainEqual(expect.objectContaining({ code: 'manifest-ingress-unmapped' }));
    expect(noteMessages(notes)).toContain('ingress has no blueprint field; the runtime reads it from the manifest');
    expect(manifestToBlueprintOverrides(emitManifest(CANVAS_APP).manifest as ManifestInput).notes.some((n) => n.code === 'manifest-ingress-unmapped')).toBe(false);
  });
});
