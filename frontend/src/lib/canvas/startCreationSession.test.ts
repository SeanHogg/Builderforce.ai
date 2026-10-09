import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanLimitError } from '@/lib/planLimitError';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  createLocalCreationSession: vi.fn(),
  startGuestCreationSession: vi.fn(),
}));

vi.mock('@/lib/builderforceApi', () => ({ creationSessionsApi: { create: mocks.create } }));
vi.mock('@/domains/canvas/infrastructure/localCanvasStore', () => ({ createLocalCreationSession: mocks.createLocalCreationSession }));
vi.mock('@/lib/guestPromptCapture', () => ({ startGuestCreationSession: mocks.startGuestCreationSession }));

const { startCreationSession } = await import('./startCreationSession');

describe('startCreationSession', () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.createLocalCreationSession.mockReset().mockReturnValue('local-fallback');
    mocks.startGuestCreationSession.mockReset().mockReturnValue('local-guest');
  });

  it('opens a server session for a person with a workspace, carrying the prompt as its first turn', async () => {
    mocks.create.mockResolvedValue({ session: { id: 'srv-1', title: 'A todo app', revision: 1 } });
    await expect(startCreationSession({ prompt: '  A todo app  ', hasTenant: true, surface: 'studio' }))
      .resolves.toEqual({ sessionId: 'srv-1', persistence: 'server' });
    expect(mocks.create).toHaveBeenCalledWith({ title: 'A todo app', initialPrompt: 'A todo app' });
    expect(mocks.startGuestCreationSession).not.toHaveBeenCalled();
  });

  it('lets the server name an empty session rather than sending a blank title', async () => {
    mocks.create.mockResolvedValue({ session: { id: 'srv-2', title: 'Untitled session', revision: 1 } });
    await startCreationSession({ prompt: '   ', hasTenant: true, surface: 'canvas' });
    expect(mocks.create).toHaveBeenCalledWith({});
  });

  it('opens a guest board for everyone else, and files the prompt under the door they used', async () => {
    await expect(startCreationSession({ prompt: 'A habit tracker', hasTenant: false, surface: 'studio' }))
      .resolves.toEqual({ sessionId: 'local-guest', persistence: 'local' });
    expect(mocks.startGuestCreationSession).toHaveBeenCalledWith('A habit tracker', { surface: 'studio' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('falls back to a LOCAL board — not a guest lead — when the server create fails', async () => {
    mocks.create.mockRejectedValue(new Error('network'));
    await expect(startCreationSession({ prompt: 'A habit tracker', hasTenant: true, surface: 'studio' }))
      .resolves.toEqual({ sessionId: 'local-fallback', persistence: 'local' });
    expect(mocks.createLocalCreationSession).toHaveBeenCalledWith('A habit tracker');
    expect(mocks.startGuestCreationSession).not.toHaveBeenCalled();
  });

  it('rethrows a plan limit instead of hiding it behind a local board', async () => {
    const limit = new PlanLimitError({ error: 'Session limit reached', currentPlan: 'free' });
    mocks.create.mockRejectedValue(limit);
    await expect(startCreationSession({ prompt: 'A habit tracker', hasTenant: true, surface: 'studio' })).rejects.toBe(limit);
    expect(mocks.createLocalCreationSession).not.toHaveBeenCalled();
  });
});
