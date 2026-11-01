import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createComposerDraftStore, type DirectedRecipient } from '@seanhogg/builderforce-brain-embedded';
import { useRecipientChoice } from './useRecipientChoice';

const PARTICIPANTS: DirectedRecipient[] = [
  { kind: 'agent', ref: 'run:1', name: 'Ada' },
  { kind: 'agent', ref: 'run:2', name: 'Grace' },
];

/** Count every render of the hook's host so a per-key re-render shows up at once. */
function renderChoice(store: ReturnType<typeof createComposerDraftStore>) {
  let renders = 0;
  const utils = renderHook(() => {
    renders += 1;
    return useRecipientChoice({ participants: PARTICIPANTS, draftStore: store, resetKey: 1 });
  });
  return { ...utils, renders: () => renders };
}

describe('useRecipientChoice on a draft store', () => {
  it('does NOT re-render the host per keystroke when there is no @mention', () => {
    const store = createComposerDraftStore();
    const h = renderChoice(store);
    const base = h.renders();

    // Twenty keystrokes, no leading @: the derived "who does the @mention name?" answer
    // stays `null`, so useSyncExternalStore sees an equal snapshot and renders nothing.
    act(() => { for (let i = 1; i <= 20; i += 1) store.set('x'.repeat(i)); });

    expect(store.get()).toBe('x'.repeat(20));
    expect(h.result.current.recipient).toBeNull();
    expect(h.renders() - base).toBe(0);
  });

  it('re-renders exactly once when a leading @mention appears, and not for each further key', () => {
    const store = createComposerDraftStore();
    const h = renderChoice(store);
    const base = h.renders();

    act(() => { store.set('@ad'); });          // mention appears   → 1 render
    act(() => { store.set('@ada'); });         // same participant  → no render
    act(() => { store.set('@ada hello'); });   // same participant  → no render
    expect(h.result.current.recipient?.name).toBe('Ada');
    expect(h.renders() - base).toBe(1);

    act(() => { store.set('@gr'); });          // different mention → 1 render
    expect(h.result.current.recipient?.name).toBe('Grace');
    expect(h.renders() - base).toBe(2);

    act(() => { store.set('plain text'); });   // mention gone      → 1 render
    expect(h.result.current.recipient).toBeNull();
    expect(h.renders() - base).toBe(3);
  });

  it('returns the participants list’s OWN member object (one identity), not a fresh copy', () => {
    const store = createComposerDraftStore();
    const h = renderChoice(store);
    act(() => { store.set('@ada'); });
    // The memoized composer compares by reference; a copied object would defeat its React.memo.
    expect(h.result.current.recipient).toBe(PARTICIPANTS[0]);
  });
});
