/**
 * Operator decision: the guest Brain is used ANONYMOUSLY. Opening it makes no API call,
 * the landing page's one-shot prompt waits for the first-run choice (THE shared gate the
 * composer's Send uses), Local only answers with nothing sent, and Hybrid — the opt-in —
 * mints the guest allowance and THEN sends.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => true),
  mintGuestSession: vi.fn(async () => ({ remaining: 5, limit: 5, enabled: true, roomsEnabled: false })),
  getGuestUsage: vi.fn(async () => ({ remaining: 5, limit: 5, enabled: true, roomsEnabled: false })),
  ensureGuestToken: vi.fn(async () => 'bfguest_token'),
}));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/hooks/usePolledResource', () => ({ usePolledResource: vi.fn() }));
vi.mock('@/lib/guestLimit', () => ({ onGuestLimit: () => () => undefined }));
vi.mock('@/lib/guestChatApi', () => ({ mintGuestSession: mocks.mintGuestSession, getGuestUsage: mocks.getGuestUsage }));
vi.mock('@/lib/guestRoomApi', () => ({
  ensureGuestToken: mocks.ensureGuestToken,
  createGuestRoom: vi.fn(),
  leaveGuestRoom: vi.fn(),
  appendGuestRoomMessages: vi.fn(),
  refreshGuestCredentials: vi.fn(),
  getActiveGuestRoom: () => null,
  getGuestDisplayName: () => '',
  setGuestDisplayName: vi.fn(),
}));
const room = { relayStream: vi.fn(), remaining: null, limit: 0, refresh: vi.fn(), setBusy: vi.fn(), streamingPeer: null };
vi.mock('@/lib/useGuestRoom', () => ({ useGuestRoom: () => room }));
const conv = { send: mocks.send, messages: [], streamingText: '', reloadMessages: vi.fn(), sending: false, error: '', clearError: vi.fn(), stop: vi.fn() };
const chats = { activeChatId: 1, create: vi.fn(async () => ({ id: 1 })), touch: vi.fn() };
vi.mock('@/lib/brain', () => ({
  useBrainChats: () => chats,
  useBrainConversation: () => conv,
  isStepMessage: () => false,
  getBrainCapability: () => undefined,
  GUEST_ROOM_CHAT_ID: -1,
}));

const { useGuestBrainSession } = await import('./useGuestBrainSession');

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  for (const mock of [mocks.send, mocks.mintGuestSession, mocks.getGuestUsage, mocks.ensureGuestToken]) mock.mockClear();
  fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('useGuestBrainSession — anonymous first', () => {
  it('opens with no API call and does not send the landing prompt before a choice', async () => {
    const { result } = renderHook(() => useGuestBrainSession({ initialPrompt: 'plan my launch' }));
    await waitFor(() => expect(result.current.modeGate.asking).toBe(true));
    expect(result.current.ready).toBe(true);
    expect(result.current.enabled).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.mintGuestSession).not.toHaveBeenCalled();
    expect(mocks.ensureGuestToken).not.toHaveBeenCalled();
    expect(mocks.getGuestUsage).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('choosing Local only answers the landing prompt locally — nothing minted, nothing fetched', async () => {
    const { result } = renderHook(() => useGuestBrainSession({ initialPrompt: 'plan my launch' }));
    await waitFor(() => expect(result.current.modeGate.asking).toBe(true));
    await act(async () => { result.current.modeGate.choose('local-only'); });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith('plan my launch'));
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.ensureGuestToken).not.toHaveBeenCalled();
    expect(mocks.mintGuestSession).not.toHaveBeenCalled();
    expect(mocks.getGuestUsage).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('choosing Hybrid mints the guest allowance, then sends the landing prompt', async () => {
    const { result } = renderHook(() => useGuestBrainSession({ initialPrompt: 'plan my launch' }));
    await waitFor(() => expect(result.current.modeGate.asking).toBe(true));
    await act(async () => { result.current.modeGate.choose('hybrid'); });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith('plan my launch'));
    expect(mocks.ensureGuestToken).toHaveBeenCalledTimes(1);
    expect(mocks.ensureGuestToken.mock.invocationCallOrder[0]).toBeLessThan(mocks.send.mock.invocationCallOrder[0]!);
  });

  it('a visitor who already chose Local only sends the landing prompt at once, still with nothing fetched', async () => {
    window.localStorage.setItem('bf_inference_mode_v1', 'local-only');
    renderHook(() => useGuestBrainSession({ initialPrompt: 'plan my launch' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith('plan my launch'));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.ensureGuestToken).not.toHaveBeenCalled();
  });
});
