import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = vi.hoisted(() => ({ claim: vi.fn() }));
vi.mock('@builderforce/knowledge-browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@builderforce/knowledge-browser')>()),
  claimLastSeenMemory: memory.claim,
}));

import { bindLastSeenOwner } from './lastSeenOwner';

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

describe('bindLastSeenOwner (Rovr)', () => {
  beforeEach(() => memory.claim.mockClear());

  it('claims the memory for the signed-in workspace, and again when the workspace changes', () => {
    const { session, change } = fakeSession({ signedIn: true, tenant: 7 });
    bindLastSeenOwner(session);
    expect(memory.claim).toHaveBeenLastCalledWith('7:rovr');
    change({ tenant: 8 });
    expect(memory.claim).toHaveBeenLastCalledWith('8:rovr');
  });

  it('returns the unsubscribe: after it, a workspace change claims nothing more', () => {
    const { session, change } = fakeSession({ signedIn: true, tenant: 7 });
    const unbind = bindLastSeenOwner(session);
    memory.claim.mockClear();
    unbind();
    change({ tenant: 8 });
    expect(memory.claim).not.toHaveBeenCalled();
  });

  it('sign-out claims it for nobody (which clears it); a later sign-in claims it anew', () => {
    const { session, change } = fakeSession({ signedIn: true, tenant: 7 });
    bindLastSeenOwner(session);
    change({ signedIn: false, tenant: null });
    expect(memory.claim).toHaveBeenLastCalledWith(null);
    change({ signedIn: true, tenant: 9 });
    expect(memory.claim).toHaveBeenLastCalledWith('9:rovr');
  });
});
