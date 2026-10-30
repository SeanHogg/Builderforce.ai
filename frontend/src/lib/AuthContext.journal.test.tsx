// @vitest-environment jsdom
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// `src/test/setup.ts` stubs `useAuth` globally; this file tests the provider itself.
vi.mock('@/lib/AuthContext', async (importOriginal) => await importOriginal<typeof import('./AuthContext')>());

const { AuthProvider, useAuth } = await import('./AuthContext');

/**
 * Words the Brain journaled on this device (a message not yet saved) belong to the signed-in person; signing out
 * takes them off the device.
 */
describe('AuthProvider sign-out and the Brain\'s journal of unsaved words', () => {
  it('logout removes every journaled word from the device', () => {
    localStorage.setItem('bf:pendingWords:1:u-1:42', JSON.stringify([{ eventKey: 'steer:x', text: 'not saved yet', session: 's', at: Date.now() }]));
    localStorage.setItem('bf:pendingBeat:s', String(Date.now()));
    localStorage.setItem('unrelated', 'kept');
    const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;
    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => result.current.logout());

    expect(localStorage.getItem('bf:pendingWords:1:u-1:42')).toBeNull();
    expect(localStorage.getItem('bf:pendingBeat:s')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('kept');
  });
});
