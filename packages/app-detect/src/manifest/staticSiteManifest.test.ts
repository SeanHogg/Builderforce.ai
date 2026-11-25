import { describe, expect, it } from 'vitest';
import { emitStaticSiteManifest, STATIC_SITE_COMMAND } from './staticSiteManifest';

describe('emitStaticSiteManifest', () => {
  it('is one frontend on the dev-server command, with no install step and no notes', () => {
    const { manifest, text, notes } = emitStaticSiteManifest('mockup');
    expect(manifest.version).toBe(1);
    expect(manifest.name).toBe('mockup');
    expect(manifest.services).toEqual({
      web: { runtime: 'node', root: '/', command: STATIC_SITE_COMMAND, port: 5173, role: 'frontend' },
    });
    expect(notes).toEqual([]);
    expect(JSON.parse(text)).toEqual(manifest);
  });

  it('names the app after its primary service when given no name', () => {
    expect(emitStaticSiteManifest().manifest.name).toBe('web');
  });
});
