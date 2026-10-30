import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({ set: vi.fn(), clear: vi.fn() }));
vi.mock('@seanhogg/builderforce-brain-embedded/pendingWords', () => ({ setPendingWordsOwner: owner.set, clearPendingWords: owner.clear }));

import { bindPendingWordsOwner } from './pendingWordsOwner';

/** A session whose sign-in state the test drives; `change()` is what the real session does on sign-in / sign-out. */
function fakeSession(initial: { signedIn: boolean; tenant: number | null }) {
  const state = { ...initial };
  const listeners = new Set<() => void>();
  return {
    session: {
      isSignedIn: () => state.signedIn,
      tenantId: () => state.tenant,
      subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
    },
    change: (next: Partial<typeof state>) => { Object.assign(state, next); for (const l of [...listeners]) l(); },
  };
}

describe('bindPendingWordsOwner (Rovr)', () => {
  beforeEach(() => { owner.set.mockClear(); owner.clear.mockClear(); });

  it('names the signed-in workspace as the journal owner, and follows a change of workspace', () => {
    const { session, change } = fakeSession({ signedIn: true, tenant: 7 });
    bindPendingWordsOwner(session);
    expect(owner.set).toHaveBeenLastCalledWith({ tenant: 7, user: 'rovr' });

    change({ tenant: 8 });
    expect(owner.set).toHaveBeenLastCalledWith({ tenant: 8, user: 'rovr' });
  });

  it('sign-out clears the journal and does NOT name an owner again while signed out', () => {
    const { session, change } = fakeSession({ signedIn: true, tenant: 7 });
    bindPendingWordsOwner(session);
    owner.set.mockClear();

    change({ signedIn: false, tenant: null });

    expect(owner.clear).toHaveBeenCalledTimes(1);
    expect(owner.set).not.toHaveBeenCalled();
  });

  it('starting signed out names no owner at all', () => {
    const { session } = fakeSession({ signedIn: false, tenant: null });
    bindPendingWordsOwner(session);
    expect(owner.set).not.toHaveBeenCalled();
  });

  it('a later sign-in names the new owner', () => {
    const { session, change } = fakeSession({ signedIn: false, tenant: null });
    bindPendingWordsOwner(session);
    change({ signedIn: true, tenant: 9 });
    expect(owner.set).toHaveBeenLastCalledWith({ tenant: 9, user: 'rovr' });
  });
});
