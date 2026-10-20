import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/builderforceApi', () => ({ brain: { getChat: vi.fn(), updateChat: vi.fn() } }));
vi.mock('@seanhogg/builderforce-brain-ui', () => ({ useChatMemorySwitch: vi.fn() }));

import { effectiveCanvasMemory } from './useCanvasMemorySwitch';

describe('effectiveCanvasMemory', () => {
  it('is OFF and loading while the chat value is in flight, even though the switch defaults ON', () => {
    expect(effectiveCanvasMemory({ chatId: 7, chatValue: undefined, userSet: false, enabled: true }))
      .toEqual({ memoryEnabled: false, memoryLoading: true });
  });

  it('stays OFF (not loading) when the chat read failed', () => {
    expect(effectiveCanvasMemory({ chatId: 7, chatValue: null, userSet: false, enabled: true }))
      .toEqual({ memoryEnabled: false, memoryLoading: false });
  });

  it("follows the chat's own value once it arrives", () => {
    expect(effectiveCanvasMemory({ chatId: 7, chatValue: true, userSet: false, enabled: true }).memoryEnabled).toBe(true);
    expect(effectiveCanvasMemory({ chatId: 7, chatValue: false, userSet: false, enabled: false }).memoryEnabled).toBe(false);
  });

  it('honours an explicit toggle in this session even when the read failed', () => {
    expect(effectiveCanvasMemory({ chatId: 7, chatValue: null, userSet: true, enabled: true }))
      .toEqual({ memoryEnabled: true, memoryLoading: false });
  });

  it('uses the local switch for a canvas with no chat behind it', () => {
    expect(effectiveCanvasMemory({ chatId: null, chatValue: undefined, userSet: false, enabled: true }))
      .toEqual({ memoryEnabled: true, memoryLoading: false });
  });
});
