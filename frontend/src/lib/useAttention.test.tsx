import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStoredTenantToken: vi.fn<() => string | null>(),
  attention: vi.fn(),
}));

vi.mock('./auth', () => ({ getStoredTenantToken: mocks.getStoredTenantToken }));
vi.mock('./builderforceApi', () => ({
  runtimeApi: { attention: mocks.attention },
}));
vi.mock('./embed/useRealtimeRoom', () => ({ useRealtimeRoom: vi.fn() }));
vi.mock('@seanhogg/builderforce-brain-embedded', () => ({
  getGlobalRunState: () => ({ running: [], awaiting: [] }),
  subscribeRunStore: () => () => undefined,
}));

import { useAttention } from './useAttention';

describe('useAttention workspace authentication', () => {
  beforeEach(() => {
    mocks.getStoredTenantToken.mockReset();
    mocks.attention.mockReset();
  });

  it('does not call the workspace endpoint without a tenant token', async () => {
    mocks.getStoredTenantToken.mockReturnValue(null);

    const { result } = renderHook(() => useAttention());
    await waitFor(() => expect(mocks.getStoredTenantToken).toHaveBeenCalled());

    expect(mocks.attention).not.toHaveBeenCalled();
    expect(result.current.counts).toEqual({ running: 0, awaiting: 0, unread: 0 });
  });

  it('loads attention when a tenant token is available', async () => {
    mocks.getStoredTenantToken.mockReturnValue('tenant-token');
    mocks.attention.mockResolvedValue({
      tasks: {},
      chats: {},
      chatUnread: {},
      counts: { running: 1, awaiting: 0, unread: 0 },
      manager: { lastRunAt: null, recentlyActive: false },
    });

    const { result } = renderHook(() => useAttention(42));
    await waitFor(() => expect(result.current.counts.running).toBe(1));

    expect(mocks.attention).toHaveBeenCalledWith(42);
  });
});
