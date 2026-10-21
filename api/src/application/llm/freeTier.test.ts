import { describe, expect, it } from 'vitest';
import { cheaperTwinsOf, costRank, orderFreeFirst, preferFreeTwins } from './freeTier';
import { capableTwinsOf } from './vendors';

const never = () => false;

describe('costRank', () => {
  it('ranks FREE, then the Cloudflare allowance, then metered', () => {
    expect(costRank('deepseek-v4-flash:cloud')).toBe(0);
    expect(costRank('@cf/qwen/qwen3-30b-a3b-fp8')).toBe(1);
    expect(costRank('deepseek/deepseek-v4-flash')).toBe(2);
  });
});

describe('capableTwinsOf', () => {
  it('finds the same weights behind another vendor', () => {
    expect(capableTwinsOf('deepseek/deepseek-v4-flash')).toContain('deepseek-v4-flash:cloud');
  });

  it('drops a twin that lacks a capability the model declares', () => {
    // Cloudflare's Gemma 4 26B declares tools; the OpenRouter free twin does not.
    expect(capableTwinsOf('@cf/google/gemma-4-26b-a4b-it')).not.toContain('google/gemma-4-26b-a4b-it:free');
  });

  it('is empty for a model with no declared weights', () => {
    expect(capableTwinsOf('anthropic/claude-sonnet-5.5')).toEqual([]);
  });
});

describe('preferFreeTwins', () => {
  it('puts the free twin directly ahead of the paid model and keeps the paid one', () => {
    expect(preferFreeTwins(['anthropic/claude-sonnet-5.5', 'deepseek/deepseek-v4-flash'], never, never))
      .toEqual(['anthropic/claude-sonnet-5.5', 'deepseek-v4-flash:cloud', 'deepseek/deepseek-v4-flash']);
  });

  it('prefers the Cloudflare allowance over a metered twin', () => {
    expect(preferFreeTwins(['meta-llama/llama-3.1-8b-instruct'], never, never))
      .toEqual(['@cf/meta/llama-3.1-8b-instruct-fp8', 'meta-llama/llama-3.1-8b-instruct']);
  });

  it('skips a cooled twin and never repeats a model', () => {
    expect(preferFreeTwins(['deepseek/deepseek-v4-flash'], (m) => m === 'deepseek-v4-flash:cloud', never))
      .toEqual(['deepseek/deepseek-v4-flash']);
    expect(preferFreeTwins(['deepseek-v4-flash:cloud', 'deepseek/deepseek-v4-flash'], never, never))
      .toEqual(['deepseek-v4-flash:cloud', 'deepseek/deepseek-v4-flash']);
  });

  it('leaves owner-served models alone in both directions', () => {
    // The tenant's own OpenRouter key serves the paid model: it gains no operator twin.
    const ownsPaid = (m: string) => m === 'deepseek/deepseek-v4-flash';
    expect(preferFreeTwins(['deepseek/deepseek-v4-flash'], never, ownsPaid)).toEqual(['deepseek/deepseek-v4-flash']);
    // The tenant's own Ollama account serves the free one: it is never offered as a twin.
    const ownsFree = (m: string) => m === 'deepseek-v4-flash:cloud';
    expect(preferFreeTwins(['deepseek/deepseek-v4-flash'], never, ownsFree)).toEqual(['deepseek/deepseek-v4-flash']);
  });
});

describe('cheaperTwinsOf', () => {
  it('lists strictly cheaper twins only, cheapest first', () => {
    expect(cheaperTwinsOf('deepseek/deepseek-v4-flash', never)).toEqual(['deepseek-v4-flash:cloud']);
    expect(cheaperTwinsOf('deepseek-v4-flash:cloud', never)).toEqual([]);
  });
});

describe('orderFreeFirst', () => {
  it('pin, free tier, connected accounts, then the rest — no repeats', () => {
    const pool = ['deepseek/deepseek-v4-flash', 'deepseek-v4-flash:cloud', '@cf/qwen/qwen3-30b-a3b-fp8'];
    expect(orderFreeFirst([], pool, ['claude-opus-5-5'], never)).toEqual([
      'deepseek-v4-flash:cloud', '@cf/qwen/qwen3-30b-a3b-fp8', 'claude-opus-5-5', 'deepseek/deepseek-v4-flash',
    ]);
    expect(orderFreeFirst(['claude-opus-5-5'], pool, ['claude-opus-5-5'], never)[0]).toBe('claude-opus-5-5');
  });

  it('an owner-served pool model waits with the connected accounts, not the free tier', () => {
    const pool = ['deepseek-v4-flash:cloud', 'gpt-oss:120b', '@cf/qwen/qwen3-30b-a3b-fp8'];
    const ownsOllama = (m: string) => m.endsWith(':cloud') || m === 'gpt-oss:120b';
    expect(orderFreeFirst([], pool, ['claude-opus-5-5'], ownsOllama)).toEqual([
      '@cf/qwen/qwen3-30b-a3b-fp8', 'claude-opus-5-5', 'deepseek-v4-flash:cloud', 'gpt-oss:120b',
    ]);
  });
});
