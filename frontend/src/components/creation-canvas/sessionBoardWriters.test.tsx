import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { resetBrainRunStore, startEngineRun } from '@seanhogg/builderforce-brain-embedded';
import { readLocalCreationSession, writeLocalCreationSession } from '@/domains/canvas/infrastructure/localCanvasStore';
import { canvasRunKey } from './brainTurn/canvasRunKey';
import { drainSessionBoardWrites, resetSessionBoardWriters, useSessionBoardWriter } from './sessionBoardWriters';

const SESSION = 'local-writers-test';

function useBoardList(persistence: 'local' | 'server' = 'local') {
  const [list, setOnScreen] = useState<string[]>([]);
  const set = useSessionBoardWriter(SESSION, persistence, 'nodes', setOnScreen);
  return { list, set };
}

afterEach(() => {
  resetSessionBoardWriters();
  resetBrainRunStore();
  localStorage.clear();
});

describe('useSessionBoardWriter', () => {
  it('is the plain setter while its own board is mounted', () => {
    const { result } = renderHook(() => useBoardList());
    act(() => result.current.set((current) => [...current, 'a']));
    expect(result.current.list).toEqual(['a']);
  });

  it('forwards a write from an unmounted board to the loaded board on screen', () => {
    const first = renderHook(() => useBoardList());
    const staleSet = first.result.current.set;
    first.unmount();
    const second = renderHook(() => useBoardList());
    act(() => drainSessionBoardWrites(SESSION));
    act(() => staleSet((current) => [...current, 'late']));
    expect(second.result.current.list).toEqual(['late']);
  });

  it('holds writes while no board is on screen and replays them once the next has loaded', () => {
    const first = renderHook(() => useBoardList());
    const staleSet = first.result.current.set;
    first.unmount();
    act(() => staleSet((current) => [...current, 'held']));
    const second = renderHook(() => useBoardList());
    // The load writes the saved board first; the held write lands on top of it.
    act(() => second.result.current.set(['saved']));
    expect(second.result.current.list).toEqual(['saved']);
    act(() => drainSessionBoardWrites(SESSION));
    expect(second.result.current.list).toEqual(['saved', 'held']);
  });

  it('keeps a device-only board\'s held writes in its stored snapshot when the turn settles off screen', async () => {
    writeLocalCreationSession(SESSION, { version: 1, title: 'T', nodes: [], edges: [], timeline: [], updatedAt: new Date().toISOString() });
    let finish!: () => void;
    const run = startEngineRun(canvasRunKey(SESSION), () => new Promise<void>((resolve) => { finish = resolve; }));
    const first = renderHook(() => {
      const [timeline, setOnScreen] = useState<Array<{ clientMessageId: string; messageRole: 'assistant'; body: string; createdAt: string }>>([]);
      return { timeline, set: useSessionBoardWriter(SESSION, 'local', 'timeline', setOnScreen) };
    });
    const staleSet = first.result.current.set;
    first.unmount();
    staleSet((current) => [...current, { clientMessageId: 'reply', messageRole: 'assistant', body: 'Done.', createdAt: '2026-10-17T00:00:00.000Z' }]);
    expect(readLocalCreationSession(SESSION)?.timeline).toEqual([]);
    finish();
    await run;
    expect(readLocalCreationSession(SESSION)?.timeline).toMatchObject([{ clientMessageId: 'reply', role: 'assistant', body: 'Done.' }]);
  });
});
