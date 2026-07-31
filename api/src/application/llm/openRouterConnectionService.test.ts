import { describe, expect, it } from 'vitest';
import {
  attributeUsageToConnections,
  bareModelId,
  connectionModelRefs,
  keyedConnectionModelRefs,
  upsertOpenRouterConnection,
  type OpenRouterConnection,
} from './openRouterConnectionService';
import { parsePrecedenceRef } from './byoPrecedence';

const connection = (
  id: number,
  models: string[],
  hasKey = false,
  priority: number | null = null,
): OpenRouterConnection => ({ id, label: `Connection ${id}`, models, hasKey, priority });

describe('OpenRouter connection routing contract', () => {
  it('keeps connection/model order, prefixes refs, and de-duplicates by first claim', () => {
    expect(connectionModelRefs([
      connection(1, ['openai/gpt-4.1', 'anthropic/claude-sonnet-5'], false, 0),
      connection(2, ['openai/gpt-4.1', 'google/gemini-2.5-pro'], true, 1),
    ])).toEqual([
      'openrouter/openai/gpt-4.1',
      'openrouter/anthropic/claude-sonnet-5',
      'openrouter/google/gemini-2.5-pro',
    ]);
  });

  it('marks only models from keyed registrations as tenant funded', () => {
    expect([...keyedConnectionModelRefs([
      connection(1, ['openai/gpt-4.1']),
      connection(2, ['google/gemini-2.5-pro'], true),
    ])]).toEqual(['openrouter/google/gemini-2.5-pro']);
  });

  it('round-trips the explicit OpenRouter routing prefix', () => {
    expect(bareModelId('openrouter/anthropic/claude-sonnet-5')).toBe('anthropic/claude-sonnet-5');
  });

  it('rejects prefixed, URL-like, or otherwise malformed model ids before touching storage', async () => {
    await expect(upsertOpenRouterConnection({} as never, 1, {
      label: 'Bad',
      models: ['openrouter/openai/gpt-4.1'],
    }, null)).resolves.toEqual({ ok: false, reason: 'invalid_models' });
  });
});

describe('OpenRouter connection usage attribution', () => {
  const usage = {
    'openrouter/openai/gpt-4.1': { requests: 3, tokens: 300, costMillicents: 3000, lastUsedAt: '2026-07-20T10:00:00.000Z' },
    'openrouter/google/gemini-2.5-pro': { requests: 2, tokens: 50, costMillicents: 2000, lastUsedAt: '2026-07-28T10:00:00.000Z' },
  };

  it('sums every model a registration owns and reports the most recent use', () => {
    expect(attributeUsageToConnections(
      [connection(1, ['openai/gpt-4.1', 'google/gemini-2.5-pro'], true, 0)],
      usage,
    )).toEqual({
      1: { requests: 5, tokens: 350, costMillicents: 5000, lastUsedAt: '2026-07-28T10:00:00.000Z' },
    });
  });

  it('gives a shared model to the HIGHER-priority registration only — never both', () => {
    // Counting it twice would report a tenant more consumption than they had, and the
    // higher-priority registration is the one that actually served the traffic (same
    // first-claim rule the key resolver and the routing seed use).
    const attributed = attributeUsageToConnections(
      [
        connection(1, ['openai/gpt-4.1'], true, 0),
        connection(2, ['openai/gpt-4.1', 'google/gemini-2.5-pro'], false, 1),
      ],
      usage,
    );
    expect(attributed[1]).toMatchObject({ requests: 3, tokens: 300 });
    expect(attributed[2]).toMatchObject({ requests: 2, tokens: 50 });
  });

  it('reports a registration that has served nothing as zero, not as missing', () => {
    // "Healthy but unused" is a real state an operator needs to see — a silent gap in the
    // list would read as "no data" rather than "this is not being used".
    expect(attributeUsageToConnections([connection(9, ['unused/model'])], usage)).toEqual({
      9: { requests: 0, tokens: 0, costMillicents: 0, lastUsedAt: null },
    });
  });
});

describe('mixed BYO precedence refs', () => {
  it('accepts provider ids and numeric OpenRouter connection refs', () => {
    expect(parsePrecedenceRef('anthropic')).toEqual({ kind: 'provider', provider: 'anthropic' });
    expect(parsePrecedenceRef('openrouter:42')).toEqual({ kind: 'connection', connectionId: 42 });
  });

  it('rejects malformed or ambiguous refs', () => {
    expect(parsePrecedenceRef('openrouter')).toBeNull();
    expect(parsePrecedenceRef('openrouter:nope')).toBeNull();
    expect(parsePrecedenceRef('openrouter:0')).toBeNull();
  });
});
