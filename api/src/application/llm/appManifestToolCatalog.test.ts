import { describe, expect, it } from 'vitest';
import { APP_MANIFEST_SCHEMA_V1, parseManifest, validateManifest } from '@seanhogg/builderforce-webcontainers-core/manifest';
import { APP_MANIFEST_TOOLS } from './appManifestToolCatalog';
import { type BuiltinCtx } from './builtinToolContext';

const ctx = {} as BuiltinCtx;
const tool = (name: string) => APP_MANIFEST_TOOLS.find((t) => t.tool === name)!;

const VALID = { version: 1, services: { web: { runtime: 'node', command: 'node server.js', port: 3000 } } };

describe('app manifest tools', () => {
  it('declares exactly the two read-only tools the hint names', () => {
    expect(APP_MANIFEST_TOOLS.map((t) => t.tool)).toEqual(['app_manifest.schema', 'app_manifest.validate']);
    expect(APP_MANIFEST_TOOLS.every((t) => t.mutates === false)).toBe(true);
  });

  it('schema returns the shared v1 schema and a capability matrix for the target', async () => {
    const r = (await tool('app_manifest.schema').run(ctx, { target: 'cloudflare' })) as Record<string, unknown>;
    expect(r.ok).toBe(true);
    expect(r.target).toBe('cloudflare');
    expect(r.schema).toBe(APP_MANIFEST_SCHEMA_V1);
    expect(Object.keys(r.capabilities as object).length).toBeGreaterThan(0);
  });

  it('schema refuses an unknown target', async () => {
    const r = (await tool('app_manifest.schema').run(ctx, { target: 'mars' })) as Record<string, unknown>;
    expect(r.ok).toBe(false);
  });

  it('validate accepts a minimal valid manifest, as an object or a string', async () => {
    const parsed = parseManifest(JSON.stringify(VALID));
    expect(validateManifest(parsed.manifest!).some((i) => i.severity === 'error')).toBe(false);
    for (const content of [VALID, JSON.stringify(VALID)]) {
      const r = (await tool('app_manifest.validate').run(ctx, { content })) as Record<string, unknown>;
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
    }
  });

  it('validate rejects an invalid manifest with errors', async () => {
    const r = (await tool('app_manifest.validate').run(ctx, {
      content: { version: 1, services: { web: { port: 3000 } } },
    })) as { ok: boolean; errors: unknown[] };
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('validate reports unreadable JSON as an error, not a throw', async () => {
    const r = (await tool('app_manifest.validate').run(ctx, { content: '{nope' })) as { ok: boolean; errors: unknown[] };
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
