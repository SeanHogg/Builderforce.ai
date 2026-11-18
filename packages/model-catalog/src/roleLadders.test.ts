import { describe, expect, it } from 'vitest';
import { bareModelId, bestLadderRank, ladderRankOf, roleHasLadder } from './index.js';

const OPUS = 'claude-opus-4-8';
const SONNET = 'claude-sonnet-5-5';
const K3 = 'direct/kimi-code/k3';
const KIMI_CODER = 'direct/kimi-code/kimi-for-coding';
const GROK = 'xai-oauth/grok-4.7';
const QWEN_MAX = 'direct/qwen/qwen3.8-max';
const CODEX = 'openai-codex/gpt-5.6-sol';

const byRung = (role: string, models: string[]): string[] =>
  [...models].sort((a, b) => (ladderRankOf(role, a) ?? 99) - (ladderRankOf(role, b) ?? 99));

describe('role ladders', () => {
  it('strips every routing prefix to the bare id', () => {
    expect(bareModelId('direct/kimi-code/k3')).toBe('k3');
    expect(bareModelId('openrouter/anthropic/claude-opus-4.8')).toBe('claude-opus-4.8');
    expect(bareModelId('googleai/gemini-2.5-pro')).toBe('gemini-2.5-pro');
    expect(bareModelId('claude-sonnet-5')).toBe('claude-sonnet-5');
  });

  it('code: the best coder per cost leads — Sonnet, then K3 and Kimi Code, Opus after Qwen Max', () => {
    expect(byRung('code', [OPUS, QWEN_MAX, GROK, KIMI_CODER, K3, SONNET]))
      .toEqual([SONNET, K3, KIMI_CODER, QWEN_MAX, OPUS, GROK]);
  });

  it('plan and review: the strongest judge leads', () => {
    for (const role of ['plan', 'review']) {
      expect(byRung(role, [SONNET, K3, OPUS, CODEX, GROK])).toEqual([OPUS, CODEX, K3, GROK, SONNET]);
    }
  });

  it('cost-first and balanced roles have no ladder', () => {
    for (const role of ['verify', 'explore', 'utility', 'chat', undefined]) {
      expect(roleHasLadder(role)).toBe(false);
      expect(ladderRankOf(role, OPUS)).toBeUndefined();
    }
  });

  it('a point release keeps its family rung; an unknown family is off the ladder', () => {
    expect(ladderRankOf('code', 'claude-sonnet-5')).toBe(ladderRankOf('code', 'claude-sonnet-6-1'));
    expect(ladderRankOf('code', 'claude-3-opus-20240229')).toBe(ladderRankOf('code', OPUS));
    expect(ladderRankOf('code', 'direct/kimi-code/k3-256k')).toBe(ladderRankOf('code', 'direct/moonshot/kimi-k3'));
    expect(ladderRankOf('code', 'direct/minimax/MiniMax-M3.1-Flash-Preview')).toBeDefined();
    expect(ladderRankOf('code', 'gpt-5-mini')).toBeUndefined();
    expect(ladderRankOf('code', '@cf/qwen/qwen3-30b-a3b-fp8')).toBeUndefined();
  });

  it('a provider ranks by the best rung any of its models holds', () => {
    expect(bestLadderRank('code', [OPUS, SONNET])).toBe(0);
    expect(bestLadderRank('code', ['nothing-known'])).toBeUndefined();
  });
});
