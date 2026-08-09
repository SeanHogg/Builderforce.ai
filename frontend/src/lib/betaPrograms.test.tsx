import { act as reactAct, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStoredWebToken: vi.fn<() => string | null>(),
  fetchBetaPrograms: vi.fn(),
  setBetaEnrollment: vi.fn(),
}));

vi.mock('./auth', () => ({ getStoredWebToken: mocks.getStoredWebToken }));
vi.mock('./releaseNotesApi', () => ({
  fetchBetaPrograms: mocks.fetchBetaPrograms,
  setBetaEnrollment: mocks.setBetaEnrollment,
}));

import { useBetaPrograms } from './betaPrograms';

const BETA = {
  id: 'b1',
  version: '2026.8.1',
  title: 'New look',
  body: null,
  category: 'improvement',
  stage: 'public_beta',
  betaOptIn: true,
  betaTerms: null,
  stageEndsAt: null,
  publishedAt: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  myStatus: null,
  agreedAt: null,
} as const;

const loaded = (overrides: Partial<typeof BETA> = {}) => ({
  betas: [{ ...BETA, ...overrides }],
  bannerBetaId: 'b1',
});

// The store is module-level and deliberately survives a remount — it is keyed to
// the SESSION, not the component. So each test signs in as a different person
// rather than reaching for a reset hook that production has no use for.
let session = 0;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStoredWebToken.mockReturnValue(`token-${++session}`);
  mocks.fetchBetaPrograms.mockResolvedValue(loaded());
});

describe('useBetaPrograms', () => {
  it('asks for nothing when nobody is signed in', async () => {
    mocks.getStoredWebToken.mockReturnValue(null);
    const { result } = renderHook(() => useBetaPrograms());
    await waitFor(() => expect(result.current.banner).toBeNull());
    expect(mocks.fetchBetaPrograms).not.toHaveBeenCalled();
  });

  it('surfaces the banner the server chose', async () => {
    const { result } = renderHook(() => useBetaPrograms());
    await waitFor(() => expect(result.current.banner?.id).toBe('b1'));
  });

  it('hides the banner the moment a dismissal is requested, before the round trip', async () => {
    let resolveCall: (v: string) => void = () => {};
    mocks.setBetaEnrollment.mockReturnValue(new Promise<string>((res) => { resolveCall = res; }));

    const { result } = renderHook(() => useBetaPrograms());
    await waitFor(() => expect(result.current.banner).not.toBeNull());

    let pending!: Promise<void>;
    reactAct(() => { pending = result.current.act('b1', 'dismiss'); });
    // Optimistic: gone already, with the request still in flight.
    expect(result.current.banner).toBeNull();

    await reactAct(async () => { resolveCall('dismissed'); await pending; });
    expect(result.current.betas[0]!.myStatus).toBe('dismissed');
  });

  it('rolls back — and brings the banner back — when the request fails', async () => {
    mocks.setBetaEnrollment.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useBetaPrograms());
    await waitFor(() => expect(result.current.banner).not.toBeNull());

    await reactAct(async () => {
      await expect(result.current.act('b1', 'join', true)).rejects.toThrow('offline');
    });
    expect(result.current.banner?.id).toBe('b1');
    expect(result.current.betas[0]!.myStatus).toBeNull();
  });

  it('drops the previous person\'s standing when the session changes', async () => {
    mocks.getStoredWebToken.mockReturnValue('token-a');
    const first = renderHook(() => useBetaPrograms());
    await waitFor(() => expect(first.result.current.banner?.id).toBe('b1'));
    first.unmount();

    // Signed out: nothing of theirs survives in this tab.
    mocks.getStoredWebToken.mockReturnValue(null);
    const signedOut = renderHook(() => useBetaPrograms());
    await waitFor(() => expect(signedOut.result.current.betas).toEqual([]));
    signedOut.unmount();

    // A different person signs in — their own betas are fetched, not reused.
    mocks.getStoredWebToken.mockReturnValue('token-b');
    mocks.fetchBetaPrograms.mockResolvedValue({ betas: [{ ...BETA, id: 'b2', myStatus: 'joined' }], bannerBetaId: null });
    const second = renderHook(() => useBetaPrograms());
    await waitFor(() => expect(second.result.current.betas[0]?.id).toBe('b2'));
    expect(second.result.current.banner).toBeNull();
    expect(mocks.fetchBetaPrograms).toHaveBeenCalledTimes(2);
  });
});
