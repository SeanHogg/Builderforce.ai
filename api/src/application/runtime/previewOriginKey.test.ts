/**
 * The server's preview-origin key must equal the runtime's (`@seanhogg/builderforce-webcontainers`
 * `previewOriginKey`, packages/browser/src/previewOrigin.ts at 2026.11.5). The expected values were
 * produced by the package's own SHA-256 (`packages/core/dist/node/hashes.js`) over the package's
 * formula for these inputs — a formula change in either repo fails here.
 */
import { describe, expect, it } from 'vitest';
import { applicationIdPattern, previewOriginKey, runtimeIdOfProject } from './previewOriginKey';

describe('previewOriginKey', () => {
  it('matches the runtime package for fixed inputs', async () => {
    expect(await previewOriginKey('42', 'app:42:0123456789abcdef')).toBe('96c02ff6106da114d069c7a8eff3c26a');
    expect(await previewOriginKey(runtimeIdOfProject(7), 'app:7:fedcba9876543210')).toBe('390741d18e1ef147980b9e81741fbf1d');
  });

  it('accepts only application ids of the given project', () => {
    expect(applicationIdPattern(42).test('app:42:0123456789abcdef')).toBe(true);
    expect(applicationIdPattern(42).test('app:43:0123456789abcdef')).toBe(false);
    expect(applicationIdPattern(4).test('app:42:0123456789abcdef')).toBe(false);
    expect(applicationIdPattern(42).test('app:42:0123456789ABCDEF')).toBe(false);
    expect(applicationIdPattern(42).test('app:42:0123456789abcdef0')).toBe(false);
  });
});
