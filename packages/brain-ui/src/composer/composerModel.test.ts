import { describe, expect, it, vi } from 'vitest';
import { EMPTY_GATEWAY_MODEL_OPTIONS, type GatewayModelOptions } from '@seanhogg/builderforce-brain-embedded';
import { composerCatalogLoaded, composerModel, modelSelectionFrom, withLocalModels } from './composerModel';

const CATALOG: GatewayModelOptions = {
  surface: {},
  options: { byo: [{ id: 'anthropic/claude', vendor: 'anthropic' }], free: ['free-1'], plan: ['plan-1'], paid: [] },
  identity: { product: 'pro', canChoose: true },
};
const LOCAL = [{ id: 'local/ollama/qwen', label: 'qwen', runtime: 'Ollama' }];

describe('composerCatalogLoaded', () => {
  it('is false before a read and after a failed read (the ONE empty shape)', () => {
    expect(composerCatalogLoaded(null)).toBe(false);
    expect(composerCatalogLoaded(undefined)).toBe(false);
    expect(composerCatalogLoaded(EMPTY_GATEWAY_MODEL_OPTIONS)).toBe(false);
    expect(composerCatalogLoaded(CATALOG)).toBe(true);
  });
});

describe('withLocalModels', () => {
  it('returns the catalogue untouched when this machine serves nothing', () => {
    expect(withLocalModels(CATALOG, [])).toBe(CATALOG);
    expect(withLocalModels(CATALOG, undefined)).toBe(CATALOG);
  });

  it('falls back to the ONE empty shape with no catalogue', () => {
    expect(withLocalModels(null, null)).toBe(EMPTY_GATEWAY_MODEL_OPTIONS);
  });

  it('merges on-device models in, with or without a catalogue', () => {
    expect(withLocalModels(CATALOG, LOCAL).options).toEqual({ ...CATALOG.options, local: LOCAL });
    const offline = withLocalModels(null, LOCAL);
    expect(offline.options.local).toEqual(LOCAL);
    expect(offline.options.plan).toEqual([]);
  });
});

describe('modelSelectionFrom', () => {
  it('reads a strict pin, else the BYO pool, else auto', () => {
    expect(modelSelectionFrom({ model: 'm', strict: true })).toEqual({ mode: 'model', model: 'm' });
    expect(modelSelectionFrom({ model: 'm' })).toEqual({ mode: 'model', model: 'm' });
    expect(modelSelectionFrom({ model: 'm', strict: false, routingMode: 'byo_pool' })).toEqual({ mode: 'byo_pool' });
    expect(modelSelectionFrom({ model: 'm', strict: false })).toEqual({ mode: 'auto' });
    expect(modelSelectionFrom({ model: null })).toEqual({ mode: 'auto' });
  });
});

describe('composerModel', () => {
  const onChange = vi.fn();
  const fallbackIdentity = { product: 'pro' as const, canChoose: false };

  it('marks entitlement pending and uses the fallback identity before any read', () => {
    const model = composerModel({ catalog: null, selection: { mode: 'auto' }, onChange, fallbackIdentity, local: LOCAL });
    expect(model.identityPending).toBe(true);
    expect(model.identity).toEqual(fallbackIdentity);
    expect(model.options.local).toEqual(LOCAL);
  });

  it('a failed read still counts as pending, with the empty shape\'s fail-closed identity', () => {
    const model = composerModel({ catalog: EMPTY_GATEWAY_MODEL_OPTIONS, selection: { mode: 'auto' }, onChange, fallbackIdentity });
    expect(model.identityPending).toBe(true);
    expect(model.identity).toEqual(EMPTY_GATEWAY_MODEL_OPTIONS.identity);
  });

  it('carries a real catalogue\'s options and verdict through', () => {
    const model = composerModel({ catalog: CATALOG, selection: { mode: 'model', model: 'plan-1' }, onChange, effective: 'plan-1' });
    expect(model.identityPending).toBe(false);
    expect(model.identity).toEqual(CATALOG.identity);
    expect(model.options).toBe(CATALOG.options);
    expect(model.effective).toBe('plan-1');
    expect(model.onChange).toBe(onChange);
  });

  it('lets a host state entitlement outright', () => {
    expect(composerModel({ catalog: null, selection: { mode: 'auto' }, onChange, identityPending: false }).identityPending).toBe(false);
  });
});
