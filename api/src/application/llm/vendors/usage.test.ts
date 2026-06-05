import { describe, expect, it } from 'vitest';
import { pickUsage } from './types';
import { openRouterModule } from './openrouter';

// ---------------------------------------------------------------------------
// pickUsage — token normalization, including the prompt-cache breakdown that
// drives correct cost accounting for caching upstreams (Anthropic via
// OpenRouter). cache_read / cache_creation are a SUBSET of prompt_tokens.
// ---------------------------------------------------------------------------

describe('pickUsage — base normalization', () => {
  it('reads OpenAI-shape prompt_tokens / completion_tokens / total_tokens', () => {
    expect(pickUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 })).toEqual({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
    });
  });

  it('falls back to Anthropic-shape input_tokens / output_tokens', () => {
    const u = pickUsage({ input_tokens: 80, output_tokens: 12 });
    expect(u.prompt_tokens).toBe(80);
    expect(u.completion_tokens).toBe(12);
  });

  it('returns an empty object for missing / malformed usage', () => {
    expect(pickUsage(undefined)).toEqual({});
    expect(pickUsage(null)).toEqual({});
    expect(pickUsage('nonsense')).toEqual({});
  });
});

describe('pickUsage — prompt-cache breakdown', () => {
  it('captures Anthropic-native cache_read_input_tokens / cache_creation_input_tokens', () => {
    const u = pickUsage({
      input_tokens: 50,
      output_tokens: 10,
      cache_read_input_tokens: 4000,
      cache_creation_input_tokens: 1200,
    });
    expect(u.cache_read_tokens).toBe(4000);
    expect(u.cache_creation_tokens).toBe(1200);
  });

  it('captures the OpenAI/OpenRouter-normalized prompt_tokens_details.cached_tokens as cache reads', () => {
    const u = pickUsage({
      prompt_tokens: 5000,
      completion_tokens: 40,
      prompt_tokens_details: { cached_tokens: 4800 },
    });
    expect(u.cache_read_tokens).toBe(4800);
    expect(u.cache_creation_tokens).toBeUndefined();
  });

  it('prefers the explicit Anthropic field over prompt_tokens_details when both exist', () => {
    const u = pickUsage({
      prompt_tokens: 5000,
      cache_read_input_tokens: 4800,
      prompt_tokens_details: { cached_tokens: 1 },
    });
    expect(u.cache_read_tokens).toBe(4800);
  });

  it('leaves cache fields undefined when the upstream reports no caching', () => {
    const u = pickUsage({ prompt_tokens: 100, completion_tokens: 20 });
    expect(u.cache_read_tokens).toBeUndefined();
    expect(u.cache_creation_tokens).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// OpenRouter catalog — the Anthropic models must be current-generation, not the
// retired Claude 3.7 Sonnet (`claude-3-7-sonnet-*` retired on the first-party
// API 2026-02-19).
// ---------------------------------------------------------------------------

describe('openRouter catalog — Anthropic models', () => {
  const ids = openRouterModule.catalog.map((m) => m.id);

  it('no longer lists the retired Claude 3.7 Sonnet', () => {
    expect(ids).not.toContain('anthropic/claude-3.7-sonnet');
  });

  it('lists current-gen Claude Sonnet 4.6 as PREMIUM', () => {
    const sonnet = openRouterModule.catalog.find((m) => m.id === 'anthropic/claude-sonnet-4.6');
    expect(sonnet).toBeDefined();
    expect(sonnet!.tier).toBe('PREMIUM');
    expect(openRouterModule.tierFor('anthropic/claude-sonnet-4.6')).toBe('PREMIUM');
  });

  it('lists Claude Haiku 4.5 as a cheap STANDARD option', () => {
    const haiku = openRouterModule.catalog.find((m) => m.id === 'anthropic/claude-haiku-4.5');
    expect(haiku).toBeDefined();
    expect(haiku!.tier).toBe('STANDARD');
  });
});
