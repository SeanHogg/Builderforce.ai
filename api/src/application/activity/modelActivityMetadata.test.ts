import { describe, it, expect } from 'vitest';
import { buildModelActivityMetadata } from './activityLog';

/**
 * The audit timeline's model chip reads these exact keys off a row's free-form
 * `metadata`, and BOTH emit sites (the Brain addressed-agent loop and the gateway
 * default-agent turn) go through this ONE builder — so the shape is a contract.
 */
describe('buildModelActivityMetadata', () => {
  it('carries the full provenance when every field is known', () => {
    expect(buildModelActivityMetadata({
      via: 'brain-chat',
      model: 'claude-opus-4-8',
      vendor: 'anthropic',
      account: 'own',
      byoFunded: true,
      evermind: { version: 3 },
      extra: { chatId: 42 },
    })).toEqual({
      via: 'brain-chat',
      model: 'claude-opus-4-8',
      vendor: 'anthropic',
      account: 'own',
      byoFunded: true,
      evermind: { version: 3 },
      chatId: 42,
    });
  });

  it('omits absent, empty and whitespace-only fields rather than writing nulls', () => {
    expect(buildModelActivityMetadata({
      via: 'gateway',
      model: '',
      vendor: '   ',
      account: null,
      byoFunded: null,
      evermind: null,
    })).toEqual({ via: 'gateway' });
  });

  it('keeps byoFunded:false — "the shared pool paid" is a real signal, not a missing one', () => {
    const meta = buildModelActivityMetadata({
      via: 'gateway',
      model: 'openai/gpt-4.1',
      byoFunded: false,
      account: 'shared_byo_unused',
    });
    expect(meta.byoFunded).toBe(false);
    expect(meta).toEqual({
      via: 'gateway',
      model: 'openai/gpt-4.1',
      account: 'shared_byo_unused',
      byoFunded: false,
    });
  });

  it('trims the model/vendor/account it stores', () => {
    expect(buildModelActivityMetadata({ via: 'gateway', model: '  gemini-2.5-pro  ', vendor: ' googleai ' }))
      .toEqual({ via: 'gateway', model: 'gemini-2.5-pro', vendor: 'googleai' });
  });

  it('produces the same shape from either emit site given the same turn', () => {
    const fromBrain = buildModelActivityMetadata({
      via: 'brain-chat', model: 'claude-sonnet-4-6', vendor: 'anthropic', account: 'own', byoFunded: true, extra: { chatId: 7 },
    });
    const fromGateway = buildModelActivityMetadata({
      via: 'gateway', model: 'claude-sonnet-4-6', vendor: 'anthropic', account: 'own', byoFunded: true, extra: { chatId: 7 },
    });
    expect(Object.keys(fromBrain).sort()).toEqual(Object.keys(fromGateway).sort());
    expect({ ...fromBrain, via: null }).toEqual({ ...fromGateway, via: null });
  });

  it('lets extra keys ride alongside without colliding with the contract keys', () => {
    const meta = buildModelActivityMetadata({ via: 'mcp', model: 'x', extra: { tool: 'tasks.create' } });
    expect(meta.tool).toBe('tasks.create');
    expect(meta.via).toBe('mcp');
  });
});
