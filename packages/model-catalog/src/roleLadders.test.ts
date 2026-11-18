import { describe, expect, it } from 'vitest';
import { bestLadderRank, ladderModelId, ladderRankOf } from './index.js';

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
  it('strips every routing prefix to the ladder id', () => {
    expect(ladderModelId('direct/kimi-code/k3')).toBe('k3');
    expect(ladderModelId('openrouter/anthropic/claude-opus-4.8')).toBe('claude-opus-4.8');
    expect(ladderModelId('googleai/gemini-2.5-pro')).toBe('gemini-2.5-pro');
    expect(ladderModelId('claude-sonnet-5')).toBe('claude-sonnet-5');
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

  it('grok-4 does not match its -fast cuts', () => {
    expect(ladderRankOf('code', 'grok-4')).toBeDefined();
    expect(ladderRankOf('code', 'xai/grok-4-0709')).toBe(ladderRankOf('code', GROK));
    for (const fast of ['grok-4-fast', 'grok-4-fast-reasoning', 'xai/grok-4-1-fast-non-reasoning', 'grok-4.1-fast']) {
      expect(ladderRankOf('code', fast), fast).toBeUndefined();
      expect(ladderRankOf('review', fast), fast).toBeUndefined();
    }
  });

  it('claude-sonnet does not match the legacy Claude 3 Sonnets', () => {
    for (const legacy of ['claude-3-sonnet-20240229', 'claude-3-5-sonnet-20241022', 'claude-3-7-sonnet-latest', 'openrouter/anthropic/claude-3.5-sonnet']) {
      expect(ladderRankOf('code', legacy), legacy).toBeUndefined();
    }
    expect(ladderRankOf('code', 'claude-sonnet-4-5')).toBe(0);
    expect(ladderRankOf('code', 'openrouter/anthropic/claude-sonnet-4.5')).toBe(0);
  });

  it('gemini-*-pro does not match the 1.x Pros', () => {
    expect(ladderRankOf('code', 'gemini-1.5-pro')).toBeUndefined();
    expect(ladderRankOf('code', 'googleai/gemini-1.0-pro-002')).toBeUndefined();
    expect(ladderRankOf('code', 'googleai/gemini-2.5-pro')).toBeDefined();
    expect(ladderRankOf('code', 'gemini-3-pro-preview')).toBe(ladderRankOf('code', 'googleai/gemini-2.5-pro'));
  });

  it('matches Bedrock-style anthropic.claude-* ids on their family rung', () => {
    expect(ladderRankOf('code', 'anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(ladderRankOf('code', SONNET));
    expect(ladderRankOf('code', 'us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(ladderRankOf('code', SONNET));
    expect(ladderRankOf('review', 'eu.anthropic.claude-opus-4-1-20250805-v1:0')).toBe(ladderRankOf('review', OPUS));
    expect(ladderRankOf('code', 'anthropic.claude-3-5-sonnet-20241022-v2:0')).toBeUndefined();
  });

  it('MiniMax M2.x sits on the rung right after M3', () => {
    for (const role of ['code', 'plan', 'review']) {
      const m3 = ladderRankOf(role, 'direct/minimax/MiniMax-M3');
      expect(m3).toBeDefined();
      expect(ladderRankOf(role, 'direct/minimax/MiniMax-M2.7')).toBe(m3! + 1);
      expect(ladderRankOf(role, 'minimax-m2')).toBe(m3! + 1);
    }
    expect(ladderRankOf('code', 'minimax-m20')).toBeUndefined();
  });

  it('a provider ranks by the best rung any of its models holds', () => {
    expect(bestLadderRank('code', [OPUS, SONNET])).toBe(0);
    expect(bestLadderRank('code', ['nothing-known'])).toBeUndefined();
  });
});
