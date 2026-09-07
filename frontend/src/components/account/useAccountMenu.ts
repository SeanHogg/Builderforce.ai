/**
 * WHAT IS IN THE ACCOUNT MENU — as data.
 *
 * The signed-in top bar used to carry six separate controls in its right corner
 * (alerts, chat, cart, theme, sign out, and a link to Settings that lived in the
 * rail instead). Each was its own button with its own badge, and together they
 * were the noisiest part of the chrome on the surface that should be the
 * quietest — the canvas. They are one avatar now, and this hook is what is
 * behind it.
 *
 * It returns SECTIONS OF ROWS rather than rendering anything, for the reason the
 * destination registry is a list and not a component: a seventh thing to put in
 * the menu should be a row added here, not another branch inside the popover.
 * Each row already carries its resolved label, its count and what it does, so
 * the view is dumb and the gates are decided in exactly one place.
 */

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useCart } from '@/lib/CartContext';
import { useIsWorkspaceAdmin } from '@/lib/rbac';
import { useTheme } from '@/lib/useTheme';
import { useOptionalMessageHub } from '@/components/messages/MessageHubContext';
import type { IconName } from '@/components/ui/Icon';
import { useNotificationFeed } from './NotificationFeedContext';

export interface AccountMenuRow {
  id: string;
  /** Resolved label — the hook owns i18n so the view never translates. */
  label: string;
  icon: IconName;
  /** Waiting items behind this row; omitted (not zero) when there is nothing. */
  count?: number;
  /** Right-aligned secondary text, e.g. which theme is on. */
  hint?: string;
  /** Navigates when set; otherwise `onSelect` runs. */
  href?: string;
  onSelect?: () => void;
  /** A preference flipped in place — the menu stays open so the change is visible. */
  keepsMenuOpen?: boolean;
  /** Sign out is the one row that reads as a departure rather than a jump. */
  tone?: 'danger';
}

export interface AccountMenuSection {
  id: string;
  rows: AccountMenuRow[];
}

export interface AccountMenu {
  /** The person the menu belongs to. */
  name: string;
  email: string;
  imageUrl: string | null;
  /** Everything waiting across every row — what the avatar's badge shows. */
  totalCount: number;
  sections: AccountMenuSection[];
}

export function useAccountMenu(): AccountMenu | null {
  const t = useTranslations('accountMenu');
  const tn = useTranslations('nav');
  const { user, isAuthenticated, hasTenant, logout } = useAuth();
  const feed = useNotificationFeed();
  const hub = useOptionalMessageHub();
  const { count: cartCount, openCart } = useCart();
  const isWorkspaceAdmin = useIsWorkspaceAdmin();
  const { theme, toggle: toggleTheme } = useTheme();

  if (!isAuthenticated || !user) return null;

  const alerts = feed?.unread ?? 0;
  const messages = hub?.available ? hub.unread : 0;

  /** A count of zero is not a badge — an empty pill reads as an alert. */
  const badge = (value: number): number | undefined => (value > 0 ? value : undefined);

  const waiting: AccountMenuRow[] = [];
  if (feed) {
    waiting.push({
      id: 'alerts', label: t('alerts'), icon: 'alert', count: badge(alerts),
      onSelect: feed.openFeed,
    });
  }
  // Self-gating, same rule the old trigger followed: a message row with nobody
  // behind it is a door into an empty room.
  if (hub?.available) {
    waiting.push({
      id: 'messages', label: t('messages'), icon: 'message', count: badge(messages),
      onSelect: hub.openHub,
    });
  }
  waiting.push({
    id: 'cart', label: t('cart'), icon: 'cart', count: badge(cartCount),
    onSelect: openCart,
  });

  const settings: AccountMenuRow[] = [
    { id: 'settings', label: t('personalSettings'), icon: 'person', href: '/settings' },
  ];
  // "The admin of the account" — the owner of this workspace, or a manager they
  // delegated to. Needs a workspace to administer, so a person still choosing one
  // does not see it.
  if (hasTenant && isWorkspaceAdmin) {
    settings.push({ id: 'workspace', label: t('workspaceSettings'), icon: 'workspace', href: '/settings?sub=workspace' });
  }
  if (user.isSuperadmin) {
    settings.push({ id: 'platform', label: tn('group.admin'), icon: 'admin', href: '/admin' });
  }

  return {
    name: user.name || user.email,
    email: user.email,
    imageUrl: user.avatar ?? null,
    totalCount: alerts + messages + cartCount,
    sections: [
      { id: 'waiting', rows: waiting },
      { id: 'settings', rows: settings },
      {
        id: 'preferences',
        rows: [{
          id: 'theme',
          label: t('theme'),
          icon: theme === 'dark' ? 'moon' : 'sun',
          hint: theme === 'dark' ? t('themeDark') : t('themeLight'),
          onSelect: toggleTheme,
          keepsMenuOpen: true,
        }],
      },
      {
        id: 'session',
        rows: [{
          id: 'signOut',
          label: t('signOut'),
          icon: 'sign-out',
          tone: 'danger',
          onSelect: () => {
            logout();
            // Full page navigation so middleware and app see cleared cookies/tokens.
            window.location.href = '/login';
          },
        }],
      },
    ],
  };
}
