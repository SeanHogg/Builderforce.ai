/**
 * @vitest-environment jsdom
 *
 * The distinction the whole guest surface rests on: "there is no workspace" and
 * "this data is invented" are DIFFERENT facts, and exactly one route makes them
 * differ.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSampleWorkspace } from './useSampleWorkspace';

// The viewer session, not the auth context: this hook reads the ONE accessor that
// answers "is there a readable workspace" with or without an `AuthProvider` above
// it, because it is compiled into the canvas and the canvas renders where there
// is none.
const viewer = { ready: true, hasTenant: false, tenantId: null as string | null };
vi.mock('@/lib/viewerSession', () => ({ useViewerSession: () => viewer }));

const { pathname } = vi.hoisted(() => ({ pathname: { current: '/insights' } }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => pathname.current,
}));

beforeEach(() => {
  viewer.ready = true;
  viewer.hasTenant = false;
  viewer.tenantId = null;
  pathname.current = '/insights';
});

const read = () => renderHook(() => useSampleWorkspace()).result.current;

describe('useSampleWorkspace', () => {
  it('reports sample data to a signed-out visitor on a preview surface', () => {
    expect(read()).toEqual({ ready: true, signedIn: false, isSample: true });
  });

  it('does NOT call a guest\'s own local-first board sample data', () => {
    // The board in front of them is real, local-first work THEY made. Labelling
    // it "the numbers are invented" would be false about the one thing on the
    // screen they actually built — but they still have no workspace, so every
    // gated action stays gated. That is why these two fields differ here and
    // only here.
    pathname.current = '/create/local-abc123';
    expect(read()).toEqual({ ready: true, signedIn: false, isSample: false });
  });

  it('reports neither to somebody with a real workspace', () => {
    viewer.hasTenant = true;
    viewer.tenantId = '7';
    expect(read()).toEqual({ ready: true, signedIn: true, isSample: false });
  });

  it('claims nothing until the session has been read off the device', () => {
    // The session is read off the device, so it is invisible on the server render
    // and the first hydrated frame FOR EVERYONE — acting on it would flash "this
    // is not your data" at a signed-in person on every hard load.
    viewer.ready = false;
    expect(read()).toEqual({ ready: false, signedIn: false, isSample: false });
  });

  it('says nothing over a durable canvas a guest cannot read', () => {
    // They are not looking at sample data, they are looking at NOTHING — the
    // page reports that itself. And the stage owns the shell's full height, so
    // a bar above it would be a false claim and a layout bug at once.
    pathname.current = '/create/sess_9f2a';
    expect(read().isSample).toBe(false);
    pathname.current = '/brainstorm';
    expect(read().isSample).toBe(false);
    pathname.current = '/workflows/builder';
    expect(read().isSample).toBe(false);
  });

  it('reports no workspace for a signed-in user who has not picked one', () => {
    // A person-level session with no workspace behind it is not a readable
    // workspace: every gate stays shut and the preview stays sample.
    viewer.hasTenant = false;
    const state = read();
    expect(state.signedIn).toBe(false);
    expect(state.isSample).toBe(true);
  });
});
