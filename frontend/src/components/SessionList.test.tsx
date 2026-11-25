// @vitest-environment jsdom
/** The rail's Recents come from the device's replica as well as the server: a board made a moment ago, or offline, is listed. */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const world = vi.hoisted(() => ({
  pathname: '/dashboard',
  server: [] as Array<{ id: string; title: string; lastActivityAt: string }>,
  drafts: [] as Array<{ sessionId: string; title: string; updatedAt: string }>,
  workspace: [] as Array<{ sessionId: string; title: string; updatedAt: string }>,
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: world.push }), usePathname: () => world.pathname }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ warning: vi.fn() }) }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ hasTenant: true }) }));
vi.mock('@/lib/ProjectScopeContext', () => ({ useOptionalProjectScope: () => null }));
vi.mock('@/lib/builderforceApi', () => ({ creationSessionsApi: { create: vi.fn(), update: vi.fn() } }));
vi.mock('@/lib/canvas/ActiveCanvasContext', () => ({ useOptionalActiveCanvas: () => null }));
vi.mock('@/components/canvas/CanvasSyncBadge', () => ({ CanvasSyncBadge: () => null }));
vi.mock('@/lib/guestPromptCapture', () => ({ startGuestCreationSession: vi.fn(() => 'guest') }));
vi.mock('@/lib/pendingWork', () => ({
  fetchRecentCanvases: async () => world.server,
  invalidateRecentCanvases: vi.fn(),
  listPendingDrafts: async () => world.drafts,
  listWorkspaceBoards: async () => world.workspace,
  updateLocalCreationSession: vi.fn(async () => undefined),
  createLocalCreationSession: vi.fn(() => 'made-on-device'),
  reportStudioFailure: vi.fn(async () => undefined),
}));

const { SessionList } = await import('./SessionList');

const entry = (id: string, title: string) => ({ sessionId: id, title, updatedAt: '2026-11-25T00:00:00.000Z' });

beforeEach(() => {
  world.pathname = '/dashboard';
  world.server = [];
  world.drafts = [];
  world.workspace = [];
  world.push.mockReset();
});

describe('SessionList from the replica', () => {
  it('lists a board the server has not heard of yet, from the device', async () => {
    world.workspace = [entry('just-made', 'Just made')];
    render(<SessionList />);
    const link = await screen.findByRole('link', { name: /Just made/ });
    expect(link).toHaveAttribute('href', '/create/just-made');
  });

  it('lists a board once when both the server and the device hold it', async () => {
    world.server = [{ id: 'both', title: 'Both', lastActivityAt: '2026-11-25T00:00:00.000Z' }];
    world.workspace = [entry('both', 'Both'), entry('only-here', 'Only here')];
    render(<SessionList />);
    await screen.findByRole('link', { name: /Only here/ });
    await waitFor(() => expect(screen.getAllByRole('link', { name: /Both/ })).toHaveLength(1));
  });

  it('marks an unbound draft as a draft, and lists it offline with no server list at all', async () => {
    world.drafts = [entry('draft-1', 'Guest draft')];
    render(<SessionList />);
    const link = await screen.findByRole('link', { name: /Guest draft/ });
    expect(link.textContent).toContain('sessions.draft');
  });
});
