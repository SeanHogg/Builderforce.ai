import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  createLocalCreationSession: vi.fn(),
  startGuestCreationSession: vi.fn(),
}));

// The server's create is mocked only to prove it is never reached: a board is made on the device first.
vi.mock('@/lib/builderforceApi', () => ({ creationSessionsApi: { create: mocks.create } }));
vi.mock('@/lib/pendingWork', () => ({ createLocalCreationSession: mocks.createLocalCreationSession }));
vi.mock('@/lib/guestPromptCapture', () => ({ startGuestCreationSession: mocks.startGuestCreationSession }));

const { startCreationSession } = await import('./startCreationSession');

describe('startCreationSession', () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.createLocalCreationSession.mockReset().mockReturnValue('board-1');
    mocks.startGuestCreationSession.mockReset().mockReturnValue('board-guest');
  });

  it('creates the board on this device first for a person with a workspace, and says it syncs', async () => {
    await expect(startCreationSession({ prompt: '  A todo app  ', isAuthenticated: true, hasTenant: true, surface: 'studio' }))
      .resolves.toEqual({ sessionId: 'board-1', persistence: 'server' });
    // The prompt rides on the board's own first transcript row; there is no server create to carry it.
    expect(mocks.createLocalCreationSession).toHaveBeenCalledWith('A todo app');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.startGuestCreationSession).not.toHaveBeenCalled();
  });

  it('starts an empty board from an empty prompt', async () => {
    await startCreationSession({ prompt: '   ', isAuthenticated: true, hasTenant: true, surface: 'canvas' });
    expect(mocks.createLocalCreationSession).toHaveBeenCalledWith('');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('opens a guest board for everyone else, and files the prompt under the door they used', async () => {
    await expect(startCreationSession({ prompt: 'A habit tracker', isAuthenticated: false, hasTenant: false, surface: 'studio' }))
      .resolves.toEqual({ sessionId: 'board-guest', persistence: 'local' });
    expect(mocks.startGuestCreationSession).toHaveBeenCalledWith('A habit tracker', { surface: 'studio' });
    expect(mocks.createLocalCreationSession).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('gives someone signed in without a workspace a board on this device, never a guest lead', async () => {
    await expect(startCreationSession({ prompt: 'A habit tracker', isAuthenticated: true, hasTenant: false, surface: 'studio' }))
      .resolves.toEqual({ sessionId: 'board-1', persistence: 'local' });
    expect(mocks.createLocalCreationSession).toHaveBeenCalledWith('A habit tracker');
    expect(mocks.startGuestCreationSession).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('has no fallback branch: a board is always created locally, whatever the network does', async () => {
    mocks.create.mockRejectedValue(new Error('network'));
    await expect(startCreationSession({ prompt: 'A habit tracker', isAuthenticated: true, hasTenant: true, surface: 'studio' }))
      .resolves.toEqual({ sessionId: 'board-1', persistence: 'server' });
    expect(mocks.createLocalCreationSession).toHaveBeenCalledTimes(1);
  });
});
