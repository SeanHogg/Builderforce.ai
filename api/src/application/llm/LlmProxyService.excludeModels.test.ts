import { describe, expect, it } from 'vitest';
import { applyExcludedModels } from './LlmProxyService';
import { stripStandardFields } from './poolRouting';

/**
 * `excludeModels` is how an agentic caller says "that model would not execute my
 * tools — give me another one". It exists because without it the only move left to
 * such a caller is to refuse to run, which is what bricked a free-plan Canvas session
 * on 2026-08-12: auto-select landed on the one free model that would not emit a tool
 * call, the surface disabled it, and every later turn died before reaching a model
 * while telling the visitor to pick a different one they had no way to pick.
 */
describe('applyExcludedModels', () => {
  const chain = ['minimaxai/minimax-m3', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'openai/gpt-oss-20b:free'];

  it('drops the excluded model and preserves the order of the rest', () => {
    expect(applyExcludedModels(chain, ['minimaxai/minimax-m3'])).toEqual([
      'nvidia/nemotron-3-ultra-550b-a55b:free', 'openai/gpt-oss-20b:free',
    ]);
  });

  it('NEVER empties the chain — a weak model beats no model', () => {
    expect(applyExcludedModels(chain, chain)).toEqual(chain);
    expect(applyExcludedModels(['only/model'], ['only/model'])).toEqual(['only/model']);
  });

  it('is a no-op without an exclusion, whatever shape the caller sent', () => {
    expect(applyExcludedModels(chain, undefined)).toBe(chain);
    expect(applyExcludedModels(chain, [])).toBe(chain);
    expect(applyExcludedModels(chain, 'minimaxai/minimax-m3')).toBe(chain);
    expect(applyExcludedModels(chain, [null, 42, '   '])).toBe(chain);
  });

  it('follows supersession, so a retired id still excludes its live successor', () => {
    expect(applyExcludedModels(['claude-opus-5', 'openai/gpt-oss-20b:free'], ['claude-opus-4-8']))
      .toEqual(['openai/gpt-oss-20b:free']);
  });
});

describe('excludeModels is gateway-only', () => {
  it('is stripped before vendor dispatch, so no upstream ever receives it', () => {
    const extra = stripStandardFields({
      model: 'x', messages: [], excludeModels: ['weak/model'], tools: [{ type: 'function' }],
    } as never);
    expect(extra).not.toHaveProperty('excludeModels');
    // `tools` still rides through — the catch-all is what forwards it.
    expect(extra).toHaveProperty('tools');
  });
});
