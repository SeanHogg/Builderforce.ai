import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WHAT THE CONSOLIDATION PROMISED.
 *
 * Six controls became one avatar, and two things have to stay true or the
 * consolidation costs the user something instead of saving them a corner: the
 * badge on the avatar has to be EVERYTHING waiting (a count that only tallied
 * alerts would hide a message), and the settings rows have to be the three
 * tiers — yours, the workspace's if you administer it, the platform's if you
 * run it — never one blanket link.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const state = vi.hoisted(() => ({
  user: { id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace', isSuperadmin: false } as Record<string, unknown> | null,
  hasTenant: true,
  workspaceAdmin: false,
  alerts: 0,
  messagesAvailable: true,
  messages: 0,
  cart: 0,
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: state.user, isAuthenticated: state.user != null, hasTenant: state.hasTenant, logout: vi.fn() }),
}));
vi.mock('@/lib/CartContext', () => ({ useCart: () => ({ count: state.cart, openCart: vi.fn() }) }));
vi.mock('@/lib/rbac', () => ({ useIsWorkspaceAdmin: () => state.workspaceAdmin }));
vi.mock('@/lib/useTheme', () => ({ useTheme: () => ({ theme: 'dark', toggle: vi.fn() }) }));
vi.mock('@/components/messages/MessageHubContext', () => ({
  useOptionalMessageHub: () => ({ available: state.messagesAvailable, unread: state.messages, openHub: vi.fn() }),
}));
vi.mock('./NotificationFeedContext', () => ({
  useNotificationFeed: () => ({ unread: state.alerts, openFeed: vi.fn() }),
}));

const { AccountMenu } = await import('./AccountMenu');

describe('the account menu', () => {
  beforeEach(() => {
    state.user = { id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace', isSuperadmin: false };
    state.hasTenant = true;
    state.workspaceAdmin = false;
    state.alerts = 0;
    state.messagesAvailable = true;
    state.messages = 0;
    state.cart = 0;
  });

  it('renders nothing at all when nobody is signed in', () => {
    state.user = null;
    const { container } = render(<AccountMenu />);
    expect(container).toBeEmptyDOMElement();
  });

  it('badges the avatar with everything waiting, not just one row', () => {
    state.alerts = 2;
    state.messages = 1;
    state.cart = 3;
    render(<AccountMenu />);
    // 2 + 1 + 3. A badge that read "2" would be the old bell wearing a new shape.
    expect(screen.getByRole('button', { name: /6 waiting/i })).toBeInTheDocument();
  });

  it('offers only personal settings to a member of the workspace', () => {
    render(<AccountMenu />);
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menuitem', { name: 'Personal settings' })).toHaveAttribute('href', '/settings');
    expect(screen.queryByRole('menuitem', { name: 'Workspace settings' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Admin' })).toBeNull();
  });

  it('adds workspace settings for the person who administers the account', () => {
    state.workspaceAdmin = true;
    render(<AccountMenu />);
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menuitem', { name: 'Workspace settings' })).toHaveAttribute('href', '/settings?sub=workspace');
    expect(screen.queryByRole('menuitem', { name: 'Admin' })).toBeNull();
  });

  it('adds the platform console only for a superadmin', () => {
    state.workspaceAdmin = true;
    state.user = { ...state.user!, isSuperadmin: true };
    render(<AccountMenu />);
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menuitem', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('drops the messages row when there is nobody to message', () => {
    state.messagesAvailable = false;
    render(<AccountMenu />);
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.queryByRole('menuitem', { name: /^Messages/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /^Alerts/ })).toBeInTheDocument();
  });
});
