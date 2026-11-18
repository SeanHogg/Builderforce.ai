/**
 * Blueprint fixtures for the run-target tests: a canvas app (Vite + Express + Postgres)
 * that runs in the browser, and a hired.video-shaped app (a wrangler Worker + a Vite
 * SPA + Neon) that must go to the container.
 */
import type { AppBlueprint, AppService } from '@builderforce/creation-canvas-contract';

export function service(overrides: Partial<AppService> & Pick<AppService, 'id' | 'kind'>): AppService {
  return {
    rootDir: '.',
    packageManager: 'npm',
    installCommand: 'npm install',
    devCommand: 'npm run dev',
    buildCommand: 'npm run build',
    startCommand: 'npm start',
    verifyCommand: null,
    outputDir: 'dist',
    ports: [3000],
    envVars: [],
    isPrimary: false,
    ...overrides,
  };
}

export function blueprint(overrides: Partial<AppBlueprint> = {}): AppBlueprint {
  return {
    id: '7-abc',
    projectId: 7,
    commitSha: 'abc',
    detectedAt: new Date(0),
    services: [],
    bindings: [],
    database: null,
    secrets: [],
    vars: [],
    domains: [],
    sources: {
      wranglerToml: false, packageJson: true, viteConfig: false, nextConfig: false, expoConfig: false,
      capacitorConfig: false, drizzleConfig: false, prismaSchema: false, dockerfile: false,
      envExample: false, githubWorkflows: false, builderforceJson: false,
    },
    overrides: null,
    isMonorepo: false,
    workspaces: [],
    ...overrides,
  };
}

/** A canvas app: a Vite frontend, an Express API with a health route, Postgres. */
export const CANVAS_APP = blueprint({
  services: [
    service({ id: 'web', kind: 'vite-react', rootDir: 'web', ports: [5173], isPrimary: true }),
    service({ id: 'api', kind: 'node', rootDir: 'api', devCommand: 'node server.js', ports: [8000], readiness: { kind: 'http', path: '/health' } }),
  ],
  database: {
    engine: 'postgres',
    migrationCommand: 'npm run migrate',
    seedCommand: null,
    migrationsPath: 'api/migrations',
    connectionSecretName: 'DATABASE_URL',
  },
  vars: [{ name: 'API_PREFIX', defaultValue: '/api' }, { name: 'NO_DEFAULT' }],
});

/** hired.video's shape: `wrangler dev` (3 DOs, R2, KV, AI, cron) + a Vite SPA + Neon. */
export const HIRED_VIDEO = blueprint({
  projectId: 99,
  services: [
    service({ id: 'hired-api', kind: 'worker', rootDir: 'api', devCommand: 'npx wrangler dev', startCommand: 'npx wrangler dev', ports: [8787] }),
    service({ id: '@hired/frontend', kind: 'vite-react', rootDir: 'frontend', devCommand: 'vite', ports: [5173], isPrimary: true }),
  ],
  bindings: [
    { name: 'ROOMS', kind: 'durableObject', className: 'RoomDO', required: true },
    { name: 'PRESENCE', kind: 'durableObject', className: 'PresenceDO', required: true },
    { name: 'CALLS', kind: 'durableObject', className: 'CallDO', required: true },
    { name: 'MEDIA', kind: 'r2', required: true },
    { name: 'CACHE', kind: 'kv', required: true },
    { name: 'AI', kind: 'ai', required: true },
    { name: 'CRON', kind: 'cron', cron: '*/5 * * * *', required: true },
  ],
  database: {
    engine: 'neon',
    migrationCommand: 'npx drizzle-kit push && node scripts/run-sql-migrations.mjs',
    seedCommand: 'node scripts/seed.mjs',
    migrationsPath: 'api/migrations',
    connectionSecretName: 'DATABASE_URL',
  },
});
