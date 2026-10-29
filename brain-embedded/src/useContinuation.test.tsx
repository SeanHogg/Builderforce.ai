import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { installRunDriver, type BrainRunDriver } from './runDriver';
import { resetBrainRunStore } from './runStore/runControl';
import { startRun } from './runStore/startRun';
import { wakeChat } from './runStore/wakeChat';
import type { BrainRunRequest } from './runStore/runTypes';
import type { BrainPersistenceAdapter } from './config';
import { useContinuation } from './useContinuation';

const persistence = { uploadUrl: (key: string) => `/u/${key}` } as unknown as BrainPersistenceAdapter;

/** A chat that has run once, so it has a request a woken turn can run with. */
async function ran(chatId: number): Promise<void> {
  let id = 0;
  const run: BrainRunRequest = {
    resolvedSystemPrompt: 'sys',
    userTurn: 'first',
    stream: async () => ({ text: 'ok', toolCalls: [], finishReason: 'stop', resolvedModel: 'm' }),
    persistence: { sendMessages: async (cid, rows) => rows.map((r) => ({ id: (id += 1), chatId: cid, createdAt: '', metadata: null, seq: id, ...r })) as never },
  };
  await startRun(chatId, run);
}

beforeEach(() => resetBrainRunStore());
afterEach(() => installRunDriver(null));

describe('useContinuation', () => {
  it('binds a chat so it can be woken, and releases it when the conversation unmounts', async () => {
    const { result, unmount } = renderHook(() => useContinuation(persistence, undefined));
    await ran(9401);
    result.current(9401);
    // Woken: the chat has a request and a binding, so the words become its next turn.
    expect(wakeChat(9401, 'hello', undefined)).toBe(true);
    await new Promise((r) => setTimeout(r, 50));

    unmount();
    expect(wakeChat(9401, 'nobody left to compose this', undefined)).toBe(false);
  });

  it('binds nothing when a host drives the run (the editor\'s host wakes its own)', async () => {
    const { result } = renderHook(() => useContinuation(persistence, undefined));
    await ran(9402);
    installRunDriver({} as BrainRunDriver);
    result.current(9402);
    expect(wakeChat(9402, 'hello', undefined)).toBe(false);
  });
});
