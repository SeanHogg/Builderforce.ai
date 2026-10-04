import { describe, expect, it } from 'vitest';
import { createMediaVendorRegistry, type MediaVendorModuleBase } from './mediaVendorRegistry';
import { tierForImageModel } from './imageVendors/registry';

type Id = 'alpha' | 'beta';
type Env = { ALPHA?: string; BETA?: string };
const mod = (id: Id, key: keyof Env, catalog: MediaVendorModuleBase<Id, Env>['catalog']): MediaVendorModuleBase<Id, Env> => ({
  id, catalog,
  apiKeyFrom: (env) => env[key] ?? null,
  tierFor: (m) => catalog.find((e) => e.id === m)?.tier ?? 'FREE',
});

const registry = createMediaVendorRegistry<Id, Env, MediaVendorModuleBase<Id, Env>>([
  mod('alpha', 'ALPHA', [
    { id: 'a1', label: 'A1', brand: 'A', tier: 'FREE' },
    { id: 'a2', label: 'A2', brand: 'A', tier: 'FREE' },
    { id: 'a-pro', label: 'A Pro', brand: 'A', tier: 'PREMIUM' },
  ]),
  mod('beta', 'BETA', [{ id: 'b1', label: 'B1', brand: 'B', tier: 'FREE' }]),
], 'alpha');

describe('createMediaVendorRegistry', () => {
  it('interleaves pools by vendor', () => {
    expect(registry.modelsByTierPrefixed('FREE')).toEqual(['alpha/a1', 'beta/b1', 'alpha/a2']);
  });

  it('resolves prefixed and bare ids', () => {
    expect(registry.resolve('beta/b1')).toEqual({ vendorId: 'beta', vendorModel: 'b1' });
    expect(registry.resolve('a2')).toEqual({ vendorId: 'alpha', vendorModel: 'a2' });
    expect(registry.vendorFor('unknown')).toBe('alpha');
  });

  it('strips the prefix before reading a tier', () => {
    expect(registry.tierFor('alpha/a-pro')).toBe('PREMIUM');
  });

  it('reports bound vendors', () => {
    expect(registry.anyBound({})).toBe(false);
    expect(registry.keyBound({ BETA: 'k' }, 'beta')).toBe(true);
  });
});

describe('image registry on the shared primitive', () => {
  it('classifies a PREFIXED paid image model as paid (the pre-fix behaviour read it as FREE)', () => {
    expect(tierForImageModel('cloudflare/@cf/leonardo/lucid-origin')).toBe('STANDARD');
    expect(tierForImageModel('fluxapi/flux-kontext-pro')).toBe('PREMIUM');
  });
});
