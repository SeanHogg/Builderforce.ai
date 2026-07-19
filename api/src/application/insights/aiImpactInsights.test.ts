import { describe, it, expect } from 'vitest';
import {
  providerForUsageRow,
  summarizeModelConsumption,
  summarizeProviderConsumption,
  summarizeAiImpact,
  PLATFORM_PROVIDER_ID,
  type UsageRow,
} from './aiImpactInsights';

/**
 * Consumption rollups — the BYO-visibility contract.
 *
 * The bug these guard: the AI Insights page sourced "models used" and its token
 * total from the run-outcome comparison matrix, which only covers scored cloud
 * runs. A tenant on their own keys (web / VSIX / on-prem) therefore saw NO models
 * and a zero token count despite real burn. These rollups read the usage ledger
 * instead, so they must stay independent of outcomes and of cost — BYO rows are
 * recorded with cost 0 by design.
 */

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 6, 14);

function row(over: Partial<UsageRow> = {}): UsageRow {
  return {
    model: 'anthropic/claude-opus-4-8',
    totalTokens: 1_000,
    costUsdMillicents: 0,
    userId: 'u1',
    createdAt: new Date(NOW - DAY),
    byo: false,
    byoProvider: null,
    ...over,
  };
}

describe('providerForUsageRow', () => {
  it('collapses every platform-funded row onto the one platform credential', () => {
    expect(providerForUsageRow(row({ byo: false, model: 'x/y' }))).toBe(PLATFORM_PROVIDER_ID);
  });

  it('names the connected integration for a stamped BYO row', () => {
    expect(providerForUsageRow(row({ byo: true, byoProvider: 'anthropic' }))).toBe('anthropic');
  });

  it('maps gateway vendor aliases onto the id the integrations UI shows', () => {
    expect(providerForUsageRow(row({ byo: true, byoProvider: 'googleai' }))).toBe('google');
    expect(providerForUsageRow(row({ byo: true, byoProvider: 'openai-codex' }))).toBe('openai');
  });

  it('backfills an unstamped BYO row from the model vendor (rows predating 0340)', () => {
    expect(providerForUsageRow(row({ byo: true, byoProvider: null, model: 'googleai/gemini-2.5-pro' })))
      .toBe('google');
  });
});

describe('summarizeModelConsumption', () => {
  it('reports BYO models even though their recorded cost is 0', () => {
    const models = summarizeModelConsumption([
      row({ model: 'claude-opus-4-8', byo: true, byoProvider: 'anthropic', totalTokens: 500 }),
      row({ model: 'claude-opus-4-8', byo: true, byoProvider: 'anthropic', totalTokens: 700 }),
    ]);
    expect(models).toHaveLength(1);
    expect(models[0]!).toMatchObject({ model: 'claude-opus-4-8', tokens: 1_200, requests: 2, byo: true, costUsd: 0 });
  });

  it('ranks by tokens and sums platform cost', () => {
    const models = summarizeModelConsumption([
      row({ model: 'small', totalTokens: 10, costUsdMillicents: 100 }),
      row({ model: 'big', totalTokens: 900, costUsdMillicents: 250 }),
      row({ model: 'big', totalTokens: 100, costUsdMillicents: 250 }),
    ]);
    expect(models.map((m) => m.model)).toEqual(['big', 'small']);
    expect(models[0]!.tokens).toBe(1_000);
    expect(models[0]!.costUsd).toBeCloseTo(0.005, 6); // 500 millicents (1 USD = 100k)
  });

  it('marks a model BYO only when EVERY row for it was tenant-funded', () => {
    const models = summarizeModelConsumption([
      row({ model: 'mixed', byo: true, byoProvider: 'anthropic' }),
      row({ model: 'mixed', byo: false }),
    ]);
    expect(models[0]!.byo).toBe(false);
    expect(models[0]!.providers.sort()).toEqual(['anthropic', PLATFORM_PROVIDER_ID].sort());
  });
});

describe('summarizeProviderConsumption', () => {
  it('splits consumption across each connected integration and the platform key', () => {
    const providers = summarizeProviderConsumption([
      row({ byo: true, byoProvider: 'anthropic', model: 'claude', totalTokens: 900 }),
      row({ byo: true, byoProvider: 'openai', model: 'gpt', totalTokens: 300 }),
      row({ byo: false, model: 'pooled', totalTokens: 50, costUsdMillicents: 400 }),
    ]);
    expect(providers.map((p) => p.provider)).toEqual(['anthropic', 'openai', PLATFORM_PROVIDER_ID]);
    expect(providers[0]!).toMatchObject({ byo: true, tokens: 900, requests: 1, models: ['claude'] });
    expect(providers[2]!).toMatchObject({ byo: false, tokens: 50 });
    expect(providers[2]!.costUsd).toBeCloseTo(0.004, 6);
  });

  it('ranks a provider\'s models by tokens', () => {
    const providers = summarizeProviderConsumption([
      row({ byo: true, byoProvider: 'anthropic', model: 'haiku', totalTokens: 10 }),
      row({ byo: true, byoProvider: 'anthropic', model: 'opus', totalTokens: 999 }),
    ]);
    expect(providers[0]!.models).toEqual(['opus', 'haiku']);
  });

  it('returns nothing for an empty window', () => {
    expect(summarizeProviderConsumption([])).toEqual([]);
  });
});

describe('summarizeAiImpact consumption block', () => {
  it('counts BYO tokens with no outcome rows at all — the reported bug', () => {
    // A BYO tenant working from VS Code: real token burn, zero scored cloud runs.
    const usage = [
      row({ model: 'claude-opus-4-8', byo: true, byoProvider: 'anthropic', totalTokens: 4_000 }),
      row({ model: 'gpt-5', byo: true, byoProvider: 'openai', totalTokens: 1_000 }),
    ];
    const out = summarizeAiImpact(usage, [], [], 30, NOW - 30 * DAY, NOW);

    // The old surface read from `comparison`, which is empty without outcomes.
    expect(out.comparison).toEqual([]);
    // The consumption block still sees everything.
    expect(out.consumption.totalTokens).toBe(5_000);
    expect(out.consumption.byoTokens).toBe(5_000);
    expect(out.consumption.totalRequests).toBe(2);
    expect(out.consumption.totalCostUsd).toBe(0);
    expect(out.consumption.models.map((m) => m.model)).toEqual(['claude-opus-4-8', 'gpt-5']);
    expect(out.consumption.providers.map((p) => p.provider)).toEqual(['anthropic', 'openai']);
  });

  it('separates BYO tokens from platform tokens in the same window', () => {
    const out = summarizeAiImpact(
      [
        row({ byo: true, byoProvider: 'anthropic', totalTokens: 700 }),
        row({ byo: false, totalTokens: 300, costUsdMillicents: 1_000 }),
      ],
      [], [], 30, NOW - 30 * DAY, NOW,
    );
    expect(out.consumption.totalTokens).toBe(1_000);
    expect(out.consumption.byoTokens).toBe(700);
    expect(out.consumption.totalCostUsd).toBeCloseTo(0.01, 6);
  });
});
