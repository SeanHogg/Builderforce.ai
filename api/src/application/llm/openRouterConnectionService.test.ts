import { describe, expect, it } from 'vitest';
import {
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
