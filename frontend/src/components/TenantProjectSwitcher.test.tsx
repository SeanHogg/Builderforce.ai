import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

const state = { live: false };
const push = vi.fn();
const setProject = vi.fn();
const closeCanvas = vi.fn();
const leaveRoom = vi.fn();
const confirm = vi.fn(async () => true);

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ tenant: { id: 't1', name: 'Acme' }, isAuthenticated: true }) }));
vi.mock('@/lib/ProjectScopeContext', () => ({
  useOptionalProjectScope: () => ({
    projects: [{ id: 7, name: 'Bakery' }], currentProjectId: null, currentProject: null, setProject, loading: false, reload: vi.fn(), adoptProject: vi.fn(),
  }),
}));
vi.mock('@/lib/canvas/ActiveCanvasContext', () => ({ useOptionalActiveCanvas: () => ({ close: closeCanvas }) }));
vi.mock('@/lib/live/LiveSessionContext', () => ({ useOptionalLiveSession: () => ({ live: state.live, leave: leaveRoom }) }));
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => confirm }));

import { TenantProjectSwitcher } from './TenantProjectSwitcher';

/**
 * The switcher does not decide what a switch means — `scopeChangeEffect` does, once
 * per switch — and these assert that the answer reaches the surfaces: the workbench
 * half through `setProject`, the board and room halves through the stage and the
 * live session, and the confirm through the shared modal.
 */
describe('TenantProjectSwitcher', () => {
  beforeEach(() => {
    state.live = false;
    vi.clearAllMocks();
    confirm.mockResolvedValue(true);
  });

  const openMenu = () => fireEvent.click(screen.getByRole('button', { expanded: false }));

  it('switches project as a filter: the board and the room are untouched, the workbench refetches', () => {
    state.live = true;
    render(<TenantProjectSwitcher />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Bakery' }));

    expect(setProject).toHaveBeenCalledWith(7, expect.objectContaining({ workbench: 'refetch', canvas: 'keep-out-of-scope', room: 'keep' }));
    expect(closeCanvas).not.toHaveBeenCalled();
    expect(leaveRoom).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('switches workspace without ceremony when nobody is on a call', async () => {
    render(<TenantProjectSwitcher />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Switch workspace…' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/tenants'));
    expect(confirm).not.toHaveBeenCalled();
    expect(closeCanvas).toHaveBeenCalledTimes(1);
    expect(leaveRoom).not.toHaveBeenCalled();
  });

  it('asks before a workspace switch ends a live call, then closes the board and leaves', async () => {
    state.live = true;
    render(<TenantProjectSwitcher />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Switch workspace…' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/tenants'));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('end the live session'),
      destructive: true,
    }));
    expect(closeCanvas).toHaveBeenCalledTimes(1);
    expect(leaveRoom).toHaveBeenCalledTimes(1);
  });

  it('keeps everything when the person declines', async () => {
    state.live = true;
    confirm.mockResolvedValue(false);
    render(<TenantProjectSwitcher />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Switch workspace…' }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
    expect(closeCanvas).not.toHaveBeenCalled();
    expect(leaveRoom).not.toHaveBeenCalled();
  });
});
