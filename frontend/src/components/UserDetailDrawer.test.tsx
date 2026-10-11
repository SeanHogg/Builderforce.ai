import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import UserDetailDrawer from './UserDetailDrawer';
import { adminApi, type AdminUser, type EffectivePermissions } from '@/lib/adminApi';

/**
 * The admin user detail is a `SlideOutPanel` (Insights S0.2), so what is worth pinning
 * is the panel contract it inherits — it is a dialog, Esc and the corner button close
 * it — plus the one action that leaves it: emulating the user.
 *
 * Copy is the passthrough key under the global next-intl mock (src/test/setup.ts).
 */

vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => vi.fn(async () => true) }));

const user = (over: Partial<AdminUser> = {}): AdminUser => ({
  id: 'user-1',
  email: 'ada@example.com',
  username: 'ada',
  displayName: 'Ada Lovelace',
  isSuperadmin: false,
  createdAt: '2026-01-02T03:04:05.000Z',
  accountType: 'standard',
  tenantCount: 2,
  ...over,
});

const tenants = [
  { id: 7, name: 'Acme', slug: 'acme' },
  { id: 9, name: 'Globex', slug: 'globex' },
];

function renderDrawer(over: Partial<AdminUser> = {}) {
  const onClose = vi.fn();
  const onStartImpersonate = vi.fn();
  const subject = user(over);
  render(
    <UserDetailDrawer user={subject} tenants={tenants} onClose={onClose} onStartImpersonate={onStartImpersonate} />,
  );
  return { onClose, onStartImpersonate, subject };
}

describe('UserDetailDrawer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders inside a dialog titled with the user', async () => {
    renderDrawer();
    const dialog = await screen.findByRole('dialog');
    // Once as the panel title, once as the profile's display-name field.
    expect(within(dialog).getAllByText('Ada Lovelace').length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getByText(/admin\.users\.drawer\.dialogLabel ada@example\.com/)).toBeTruthy();
    // The profile tab is the landing tab and needs no fetch.
    expect(within(dialog).getByText('user-1')).toBeTruthy();
  });

  it('calls onClose on Escape', async () => {
    const { onClose } = renderDrawer();
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose from the panel close button', async () => {
    const { onClose } = renderDrawer();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'common.closePanel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hands the user to onStartImpersonate from the emulate action', async () => {
    const { onClose, onStartImpersonate, subject } = renderDrawer();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'admin.users.emulate' }));
    expect(onStartImpersonate).toHaveBeenCalledWith(subject);
    expect(onClose).toHaveBeenCalled();
  });

  it('offers no emulate action for a superadmin', async () => {
    renderDrawer({ isSuperadmin: true });
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'admin.users.emulate' })).toBeNull();
  });

  it('loads permissions for the first workspace when the tab opens', async () => {
    const perms: EffectivePermissions = {
      userId: 'user-1',
      tenantId: 7,
      role: 'developer',
      permissions: ['tasks.read'],
      rolePermissions: ['tasks.read'],
      modulePermissions: [],
      userGrants: [],
      userRevocations: [],
    };
    const spy = vi.spyOn(adminApi, 'effectivePermissions').mockResolvedValue(perms);
    renderDrawer();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'admin.users.drawer.tabPermissions' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('user-1', 7));
    expect(await screen.findByText('tasks.read')).toBeTruthy();
  });
});
