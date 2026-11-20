import { describe, expect, it } from 'vitest';
import { composeKit, composeParts, resolveKit, MANIFEST_FILE, MANIFEST_SCHEMA_URL } from './compose';
import { KIT_PARTS, NAMED_KITS, listKitOptions } from './registry';
import type { KitPart } from './types';

const KIT_ROOT_FILES = new Set([MANIFEST_FILE, 'README.md']);

describe('composeKit — the W11 kit matrix (steps 1–2 inputs)', () => {
  for (const kitId of NAMED_KITS) {
    for (const extras of [[], ['postgres']]) {
      it(`${kitId}${extras.length ? ` --with ${extras.join(',')}` : ''} composes with zero issues and a runnable v1 manifest`, () => {
        const kit = composeKit(kitId, extras);
        expect(kit.issues).toEqual([]);

        const { manifest } = kit;
        expect(manifest.$schema).toBe(MANIFEST_SCHEMA_URL);
        expect(manifest.version).toBe(1);
        expect(manifest.services.web).toMatchObject({ root: '/web', role: 'frontend', port: 5173 });
        expect(manifest.services.web!.dependsOn).toContain('api');
        expect(manifest.services.api).toMatchObject({ root: '/api', role: 'backend', port: 8000, readiness: { http: '/health' } });
        expect(manifest.ingress.routes).toEqual([{ path: '/api', service: 'api' }, { path: '/', service: 'web' }]);
        expect(manifest.environments.local).toEqual({ target: 'browser', tier: 'non-production', debug: true });
        expect(manifest.environments.prod).toEqual({ target: 'cloudflare', tier: 'production' });

        // Every dependency is a declared service, and every one-off install is held to exit-zero.
        for (const service of Object.values(manifest.services)) {
          for (const dep of service.dependsOn ?? []) expect(manifest.services[dep]).toBeDefined();
        }
        for (const [id, service] of Object.entries(manifest.services)) {
          if (id.startsWith('install-')) expect(service).toMatchObject({ readiness: { exitZero: true }, restart: 'never' });
        }

        for (const path of Object.keys(kit.files)) {
          if (!KIT_ROOT_FILES.has(path)) expect(path).toMatch(/^(web|api)\//);
        }
        expect(kit.files[MANIFEST_FILE]).toBe(kit.manifestText);
        expect(JSON.parse(kit.manifestText)).toEqual(manifest);
        expect(kit.files['README.md']).toContain('/launch');

        if (extras.includes('postgres')) {
          expect(manifest.resources).toEqual({ db: { type: 'postgres', persistent: true } });
          expect(manifest.services.api!.uses).toEqual(['db']);
          expect(kit.files['api/migrations/001_items.sql']).toContain('CREATE TABLE IF NOT EXISTS items');
        } else {
          expect(manifest.resources).toBeUndefined();
          expect(manifest.services.api!.uses).toBeUndefined();
        }
      });
    }
  }

  it('accepts aliases and canonical ids for the same kit', () => {
    expect(resolveKit('react-node').kit).toEqual({ id: 'react-vite-node-express', frontend: 'react-vite', backend: 'node-express', extras: [] });
    expect(composeKit('react-vite-node-express').manifest).toEqual(composeKit('react-node').manifest);
    expect(resolveKit('vue-fastapi', ['pg']).kit).toEqual({ id: 'vue-vite-python-fastapi', frontend: 'vue-vite', backend: 'python-fastapi', extras: ['postgres'] });
  });

  it('composes react-vite alone: one frontend, no backend, no dependency on one', () => {
    const kit = composeKit('react-vite');
    expect(kit.issues).toEqual([]);
    expect(Object.keys(kit.manifest.services).sort()).toEqual(['install-web', 'web']);
    expect(kit.manifest.services.web!.dependsOn).toEqual(['install-web']);
    expect(kit.manifest.ingress.routes).toEqual([{ path: '/', service: 'web' }]);
  });

  it('models installs as one-off services the service depends on; .NET restores itself', () => {
    const node = composeKit('react-node').manifest.services;
    expect(node['install-api']).toEqual({ runtime: 'node', root: '/api', command: 'npm install', readiness: { exitZero: true }, restart: 'never' });
    expect(node.api!.dependsOn).toEqual(['install-api']);
    expect(composeKit('react-fastapi').manifest.services['install-api']).toMatchObject({ runtime: 'python', command: 'pip install -r requirements.txt' });
    expect(composeKit('react-laravel').manifest.services['install-api']).toMatchObject({ runtime: 'php', command: 'composer install' });
    const dotnet = composeKit('react-dotnet').manifest.services;
    expect(dotnet['install-api']).toBeUndefined();
    expect(dotnet.api).toMatchObject({ runtime: 'dotnet', command: 'dotnet run' });
  });

  it('reports an unknown kit with every valid id, and writes nothing', () => {
    const kit = composeKit('svelte-rust');
    expect(kit.files).toEqual({});
    expect(kit.issues).toHaveLength(1);
    const [issue] = kit.issues;
    expect(issue!.code).toBe('unknown-kit');
    const options = listKitOptions();
    for (const id of [...options.namedKits, ...options.frontends.map((o) => o.id), ...options.backends.map((o) => o.id)]) {
      expect(issue!.message).toContain(id);
    }
  });

  it('reports an unknown extra with the valid extras and still composes the kit', () => {
    const kit = composeKit('react-node', ['redis']);
    expect(kit.issues).toEqual([expect.objectContaining({ code: 'unknown-extra', key: 'redis' })]);
    expect(kit.issues[0]!.message).toContain('postgres');
    expect(kit.manifest.services.api).toBeDefined();
  });

  it('reports an extra whose required backend is missing', () => {
    const kit = composeKit('react-vite', ['postgres']);
    expect(kit.issues.map((issue) => issue.code).sort()).toEqual(['missing-requirement', 'unknown-service']);
  });
});

describe('composeParts — fragments merge by key, never by overwrite', () => {
  const twin: KitPart = { ...KIT_PARTS['node-express']!, id: 'node-twin' };

  it('reports two parts writing one path or declaring one service, and keeps the first', () => {
    const kit = composeParts('clash', [KIT_PARTS['react-vite']!, KIT_PARTS['node-express']!, twin]);
    const codes = new Set(kit.issues.map((issue) => issue.code));
    expect(codes).toEqual(new Set(['path-conflict', 'service-conflict']));
    expect(kit.issues.find((issue) => issue.key === 'api/server.js')!.message).toContain('node-twin');
    expect(kit.files['api/server.js']).toBe(KIT_PARTS['node-express']!.files['server.js']);
  });

  it('reports two parts declaring one resource', () => {
    const second: KitPart = { ...KIT_PARTS.postgres!, id: 'postgres-twin', files: {} };
    const kit = composeParts('clash', [KIT_PARTS['react-vite']!, KIT_PARTS['node-express']!, KIT_PARTS.postgres!, second]);
    expect(kit.issues).toEqual([expect.objectContaining({ code: 'resource-conflict', key: 'db' })]);
    expect(kit.manifest.services.api!.uses).toEqual(['db']);
  });

  it('never mutates the parts it composes', () => {
    const before = JSON.stringify(KIT_PARTS);
    composeKit('react-node', ['postgres']);
    composeKit('angular-node', ['postgres']);
    expect(JSON.stringify(KIT_PARTS)).toBe(before);
  });
});
