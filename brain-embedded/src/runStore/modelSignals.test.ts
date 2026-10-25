import { beforeEach, describe, expect, it } from 'vitest';
import type { BrainTraceEvent } from '../brainTriage';
import { getRunSnapshot, getRunTrace, resetBrainRunStore, startRun } from '../brainRunStore';
import { MODEL_DOWNGRADE_LABEL, modelDowngradeEvent } from './modelDowngrade';
import { MODEL_PREFLIGHT_LABEL, modelPreflightEvent } from './modelPreflight';

const TS = '2026-10-25T00:00:00.000Z';

describe('modelDowngradeEvent', () => {
  it('keeps the pinned-model failover rule', () => {
    const e = modelDowngradeEvent({ requested: 'anthropic/claude-opus', resolved: 'minimax/M3', step: 2, ts: TS, events: [] });
    expect(e?.label).toBe(MODEL_DOWNGRADE_LABEL);
    expect(e?.args).toEqual({ requestedModel: 'anthropic/claude-opus', model: 'minimax/M3', step: 2 });
    expect(modelDowngradeEvent({ requested: 'a', resolved: 'a', step: 0, ts: TS, events: [] })).toBeNull();
  });

  it('fires for an auto-routed turn that carried a BYO-unresolved signal', () => {
    const e = modelDowngradeEvent({ requested: 'default', resolved: 'minimax/MiniMax-M3.1-Flash-Preview', byoUnresolved: 'anthropic:expired', step: 0, ts: TS, events: [] });
    expect(e?.args).toEqual({ requestedModel: 'default', model: 'minimax/MiniMax-M3.1-Flash-Preview', step: 0, byoUnresolved: 'anthropic:expired' });
    expect(String(e?.result)).toContain('anthropic:expired');
  });

  it('stays quiet for an auto-routed turn with no signal, and says it once per served model', () => {
    expect(modelDowngradeEvent({ requested: 'default', resolved: 'x/flash', step: 0, ts: TS, events: [] })).toBeNull();
    const first = modelDowngradeEvent({ requested: 'default', resolved: 'x/flash', byoUnresolved: 'anthropic:revoked', step: 0, ts: TS, events: [] })!;
    const events: BrainTraceEvent[] = [first];
    expect(modelDowngradeEvent({ requested: 'default', resolved: 'x/flash', byoUnresolved: 'anthropic:revoked', step: 1, ts: TS, events })).toBeNull();
    expect(modelDowngradeEvent({ requested: 'default', resolved: 'y/other', byoUnresolved: 'anthropic:revoked', step: 2, ts: TS, events })?.args).toMatchObject({ model: 'y/other' });
  });
});

describe('a run with a model preflight', () => {
  beforeEach(resetBrainRunStore);
  const persistence = {
    sendMessages: async (chatId: number, msgs: Array<{ role: string; content: string }>) => msgs.map((m, i) => ({ id: 7700 + i, chatId, createdAt: '', ...m })),
  } as never;

  it('shows the unresolved account before the first turn runs', async () => {
    let seenAtTurn1: string[] | null = null;
    let preflightBeforeTurn = false;
    await startRun(4701, {
      resolvedSystemPrompt: 'sys',
      persistence,
      userTurn: 'plan the PRD update',
      modelPreflight: async () => ({ byoUnresolved: ['anthropic:expired'] }),
      stream: async () => {
        seenAtTurn1 ??= [...getRunSnapshot(4701).byoUnresolved];
        preflightBeforeTurn = getRunTrace(4701).some((e) => e.label === MODEL_PREFLIGHT_LABEL);
        return { text: 'ok', toolCalls: [], finishReason: 'stop' };
      },
    });
    expect(seenAtTurn1).toEqual(['anthropic:expired']);
    expect(preflightBeforeTurn).toBe(true);
  });

  it('a failing preflight costs the notice, never the run', async () => {
    await startRun(4702, {
      resolvedSystemPrompt: 'sys',
      persistence,
      userTurn: 'go',
      modelPreflight: async () => { throw new Error('offline'); },
      stream: async () => ({ text: 'ok', toolCalls: [], finishReason: 'stop' }),
    });
    expect(getRunSnapshot(4702).byoUnresolved).toEqual([]);
    expect(getRunTrace(4702).some((e) => e.label === MODEL_PREFLIGHT_LABEL)).toBe(false);
  });
});

describe('modelPreflightEvent', () => {
  it('says nothing when every connected account resolves', () => {
    expect(modelPreflightEvent({ byoUnresolved: [] }, TS)).toBeNull();
    expect(modelPreflightEvent(undefined, TS)).toBeNull();
  });

  it('names the provider, the reason, the remedy and the fallback', () => {
    const e = modelPreflightEvent({ byoUnresolved: ['anthropic:expired'], fallback: 'MiniMax-M3.1-Flash' }, TS)!;
    expect(e.label).toBe(MODEL_PREFLIGHT_LABEL);
    expect(e.args).toEqual({ byoUnresolved: 'anthropic:expired', fallback: 'MiniMax-M3.1-Flash' });
    expect(String(e.result)).toContain('anthropic (expired)');
    expect(String(e.result)).toContain('Settings ▸ API Keys');
    expect(String(e.result)).toContain('This run will use MiniMax-M3.1-Flash instead.');
  });
});
