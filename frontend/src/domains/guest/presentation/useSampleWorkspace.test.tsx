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

const auth = { authReady: true, isAuthenticated: false, hasTenant: false };
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => auth }));

const { pathname } = vi.hoisted(() => ({ pathname: { current: '/insights' } }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => pathname.current,
}));

beforeEach(() => {
  auth.authReady = true;
  auth.isAuthenticated = false;
  auth.hasTenant = false;
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
    auth.isAuthenticated = true;
    auth.hasTenant = true;
    expect(read()).toEqual({ ready: true, signedIn: true, isSample: false });
  });

  it('claims nothing until the session has been read off the device', () => {
    // `isAuthenticated` is false on the server render and the first hydrated
    // frame FOR EVERYONE, so acting on it would flash "this is not your data"
    // at a signed-in person on every hard load.
    auth.authReady = false;
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
    auth.isAuthenticated = true;
    auth.hasTenant = false;
    const state = read();
    expect(state.signedIn).toBe(false);
    expect(state.isSample).toBe(true);
  });
});
