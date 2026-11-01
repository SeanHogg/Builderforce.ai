import { type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createComposerDraftStore, type ComposerDraftStore, type DirectedRecipient } from '@seanhogg/builderforce-brain-embedded';
import { useRecipientChoice } from './useRecipientChoice';

type RecipientChoiceResult = ReturnType<typeof useRecipientChoice>;

const PARTICIPANTS: DirectedRecipient[] = [
  { kind: 'agent', ref: 'run:1', name: 'Ada' },
  { kind: 'agent', ref: 'run:2', name: 'Grace' },
];

/** A minimal host that owns the hook — counts its own renders so a per-key re-render shows at once. */
function makeHost(store: ComposerDraftStore) {
  const probe: { renders: number; result: RecipientChoiceResult | null } = { renders: 0, result: null };
  function Host(): ReactNode {
    probe.renders += 1;
    probe.result = useRecipientChoice({ participants: PARTICIPANTS, draftStore: store, resetKey: 1 });
    return null;
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  let root: Root | null = null;
  act(() => { root = createRoot(el); root.render(<Host />); });
  return {
    probe,
    unmount() {
      act(() => root?.unmount());
      el.remove();
    },
  };
}

afterEach(() => { /* each test makes and unmounts its own host */ });

describe('useRecipientChoice on a draft store', () => {
  it('does NOT re-render the host per keystroke when there is no @mention', () => {
    const store = createComposerDraftStore();
    const host = makeHost(store);
    const base = host.probe.renders;

    // Twenty keystrokes, no leading @: the derived "who does the @mention name?" answer
    // stays `null`, so useSyncExternalStore sees an equal snapshot and renders nothing.
    act(() => { for (let i = 1; i <= 20; i += 1) store.set('x'.repeat(i)); });

    expect(store.get()).toBe('x'.repeat(20));
    expect(host.probe.result?.recipient).toBeNull();
    expect(host.probe.renders - base).toBe(0);
    host.unmount();
  });

  it('re-renders only when the leading @mention answer CHANGES, not per key', () => {
    const store = createComposerDraftStore();
    const host = makeHost(store);
    const base = host.probe.renders;

    // Each change of answer re-renders a bounded, constant number of times (React's
    // useSyncExternalStore re-check, 2), never once-per-key. What must NOT happen is a
    // render for a key that keeps the same answer — that was the per-key typing storm.
    act(() => { store.set('@ad'); });          // answer null → Ada     : re-renders
    act(() => { store.set('@ada'); });         // answer still Ada      : NO render
    act(() => { store.set('@ada hello'); });   // answer still Ada      : NO render
    expect(host.probe.result?.recipient?.name).toBe('Ada');
    const afterAda = host.probe.renders - base;
    expect(afterAda).toBeGreaterThan(0);
    expect(afterAda).toBeLessThanOrEqual(2);   // bounded, not one-per-key

    const beforeGrace = host.probe.renders;
    act(() => { store.set('@gr'); });          // answer Ada → Grace    : re-renders
    act(() => { store.set('@grace'); });       // answer still Grace    : NO render
    expect(host.probe.result?.recipient?.name).toBe('Grace');
    expect(host.probe.renders - beforeGrace).toBeLessThanOrEqual(2);

    const beforeClear = host.probe.renders;
    act(() => { store.set('plain text'); });   // answer Grace → null   : re-renders
    expect(host.probe.result?.recipient).toBeNull();
    expect(host.probe.renders - beforeClear).toBeLessThanOrEqual(2);
    host.unmount();
  });

  it('returns the participants list’s OWN member object (one identity), not a fresh copy', () => {
    const store = createComposerDraftStore();
    const host = makeHost(store);
    act(() => { store.set('@ada'); });
    // The memoized composer compares by reference; a copied object would defeat its React.memo.
    expect(host.probe.result?.recipient).toBe(PARTICIPANTS[0]);
    host.unmount();
  });
});
