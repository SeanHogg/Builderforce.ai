import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  ensureGuestToken: vi.fn(),
}));

vi.mock('@seanhogg/builderforce-brain-embedded', () => ({ streamChatCompletion: mocks.stream }));
vi.mock('@/lib/brain/runtime', () => ({ brainConfig: { transport: { baseUrl: 'tenant' } } }));
vi.mock('@/lib/brain/guestRuntime', () => ({ guestBrainConfig: { transport: { baseUrl: 'guest' } } }));
vi.mock('@/lib/guestRoomApi', () => ({ ensureGuestToken: mocks.ensureGuestToken }));
vi.mock('@/lib/creationCanvasAi', () => ({ GuestAiUnavailableError: class extends Error {} }));

import { executeModelComparison } from './modelComparison';

describe('executeModelComparison', () => {
  beforeEach(() => {
    mocks.stream.mockReset().mockResolvedValue({ text: '  selected model output  ', toolCalls: [] });
    mocks.ensureGuestToken.mockReset().mockResolvedValue(true);
  });

  it('hard-pins the selected model and disables tools', async () => {
    await expect(executeModelComparison({ prompt: 'Solve it', model: 'anthropic/claude-opus-5', persistence: 'server' }))
      .resolves.toBe('selected model output');
    expect(mocks.stream).toHaveBeenCalledWith(expect.objectContaining({
      model: 'anthropic/claude-opus-5',
      modelStrict: true,
      tool_choice: 'none',
      transport: { baseUrl: 'tenant' },
    }));
  });

  it('uses guest auth for a local comparison', async () => {
    await executeModelComparison({ prompt: 'Compare', model: 'openai/gpt-5', persistence: 'local' });
    expect(mocks.ensureGuestToken).toHaveBeenCalledOnce();
    expect(mocks.stream).toHaveBeenCalledWith(expect.objectContaining({ transport: { baseUrl: 'guest' } }));
  });
});
