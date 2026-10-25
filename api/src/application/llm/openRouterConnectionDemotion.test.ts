import { describe, expect, it } from 'vitest';
import { connectionOwnerOf, demoteAlertedConnections, type OpenRouterConnection } from './openRouterConnectionService';
import { connectionAuthAlertsFromFailovers } from './providerAuthAlerts';

// VS Code chat #6: one tenant connection answered 401 on three models ~590 times each in a
// night, because only the daily probe ever alerted a connection and the seed never read it.

const conn = (id: number, models: string[], hasKey = true, priority: number | null = id): OpenRouterConnection =>
  ({ id, label: `c${id}`, models, hasKey, priority });

describe('connectionOwnerOf', () => {
  const owner = connectionOwnerOf([conn(1, ['deepseek/v4']), conn(2, ['deepseek/v4', 'kimi/k3']), conn(3, ['free/x'], false)]);

  it('names the highest-priority keyed connection that serves a model', () => {
    expect(owner('openrouter/deepseek/v4')).toBe(1);
    expect(owner('openrouter/kimi/k3')).toBe(2);
  });

  it('is null for a model on the operator key, or one no connection lists', () => {
    expect(owner('openrouter/free/x')).toBeNull();
    expect(owner('direct/minimax/MiniMax-M3')).toBeNull();
  });
});

describe('connectionAuthAlertsFromFailovers', () => {
  const owner = connectionOwnerOf([conn(1, ['deepseek/v4', 'kimi/k3'])]);

  it('raises one alert per refused connection from a live cascade', () => {
    const alerts = connectionAuthAlertsFromFailovers([
      { vendor: 'openrouter', code: 401, model: 'openrouter/deepseek/v4' },
      { vendor: 'openrouter', code: 401, model: 'openrouter/kimi/k3' },
    ], owner, 5);
    expect(alerts).toEqual([{ connectionId: 1, reason: 'rejected', status: 401, vendor: 'openrouter', at: 5 }]);
  });

  it('ignores a transient failure and a model no keyed connection owns', () => {
    expect(connectionAuthAlertsFromFailovers([
      { vendor: 'openrouter', code: 503, model: 'openrouter/deepseek/v4' },
      { vendor: 'minimax', code: 401, model: 'direct/minimax/MiniMax-M3' },
    ], owner)).toEqual([]);
  });
});

describe('demoteAlertedConnections', () => {
  it('moves a refused connection behind the healthy ones and drops its precedence', () => {
    const out = demoteAlertedConnections([conn(1, ['a']), conn(2, ['b']), conn(3, ['c'])], new Set([1]));
    expect(out.map((c) => c.id)).toEqual([2, 3, 1]);
    expect(out[2]!.priority).toBeNull();
  });

  it('keeps every connection — demote, never remove', () => {
    const list = [conn(1, ['a']), conn(2, ['b'])];
    expect(demoteAlertedConnections(list, new Set([1, 2]))).toHaveLength(2);
    expect(demoteAlertedConnections(list, new Set())).toEqual(list);
  });
});
