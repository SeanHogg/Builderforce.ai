'use client';

import { Icon } from '@/components/ui/Icon';
import { Select } from '@/components/Select';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { signInHref } from '@/lib/auth';
import { ButtonLink } from '@/components/ui';
import { ThemeToggleButton } from '@/components/ThemeToggleButton';
import { useRolePreview, type PreviewRole } from '@/lib/RolePreviewContext';
import { useEmulation } from '@/lib/EmulationContext';
import ShoppingCart from './ShoppingCart';
import { MessageHubPanel } from './messages/MessageHub';
import { AccountMenu } from './account/AccountMenu';
import { NotificationsPanel } from './account/NotificationsPanel';
import { ManagerStatusIndicator } from './ManagerStatusIndicator';
import { TenantProjectSwitcher } from './TenantProjectSwitcher';
import { CommandPalette } from './workspace/CommandPalette';
import { OnboardingProgressPill } from './OnboardingProgressPill';
import { useOnboardingPrompt } from '@/lib/onboarding';

const PREVIEW_ROLES: PreviewRole[] = ['owner', 'manager', 'developer', 'viewer'];

export default function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const t = useTranslations('topbar');
  const tc = useTranslations('common');
  const pathname = usePathname() || '';
  const { user, isAuthenticated, hasTenant } = useAuth();
  const { previewRole, startPreview, exitPreview } = useRolePreview();
  const { emulation } = useEmulation();
  const { show: showOnboarding } = useOnboardingPrompt();

  return (
    <header className={`topbar${previewRole ? ' topbar--role-preview' : ''}`}>
      <div className="topbar-left">
        <button
          type="button"
          className="topbar-hamburger"
          onClick={onMenuClick}
          aria-label={t('openMenu')}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <Link href={isAuthenticated ? '/dashboard' : '/'} className="brand" style={{ textDecoration: 'none' }}>
          <Image
            src="/agentHost.png"
            alt={t('brandAlt')}
            width={28}
            height={28}
            className="brand-logo"
            style={{ filter: 'drop-shadow(0 0 8px var(--logo-glow))' }}
          />
          <span className="brand-name">{t('brandName')}</span>
          <span className="brand-badge">{t('betaBadge')}</span>
        </Link>
      </div>
      <div className="topbar-center">
        {previewRole ? (
          <span className="topbar-preview-info">
            <span aria-hidden="true"><Icon source="👁" size="1em" /></span>
            {t('previewingAs', { role: previewRole })}
          </span>
        ) : (
          <Link href="/marketplace" className="tenant-chip topbar-center-link" style={{ textDecoration: 'none' }}>
            <Icon name="cart" size={16} />
            {t('marketplace')}
          </Link>
        )}
      </div>
      <div className="topbar-right">
        {/* Workspace scope stays in the header. Canvas/session navigation lives in
            the sidebar, so it has one canonical home instead of two selectors. */}
        <TenantProjectSwitcher />
        {/* The room is NOT here. Starting, reading and leaving a call all live in
            the live dock at the bottom of the shell (`components/live/LiveBar`),
            because the call's active state IS a band of chrome down there — and
            a control whose "on" state appears in the opposite corner from its
            "off" state has two homes. See that file's header. */}
        {/* Search-first navigation over the shared destination registry. Self-gates
            on a tenant, and hides its trigger on phones where the bottom nav leads. */}
        <CommandPalette />

        {/* New-account setup progress — self-gates to nothing once onboarding is
            complete/dismissed or for non-owner members. Nothing replaces it once
            setup is done: the founder's-journey chip that used to take this slot
            said the same word ("Idea") that the canvas's own phase stepper and
            the shell panel's stage switcher already say, on the surface where the
            chrome has to be quietest. One fact, one place. */}
        {isAuthenticated && showOnboarding && <OnboardingProgressPill />}

        {/* Role preview — superadmin only, not during emulation */}
        {isAuthenticated && user?.isSuperadmin && !emulation && (
          <div className="topbar-role-preview">
            {previewRole ? (
              <>
                <span className="topbar-role-preview__badge">
                  {t('previewBadge', { role: previewRole })}
                </span>
                <button
                  type="button"
                  className="topbar-role-preview__exit"
                  onClick={exitPreview}
                  title={t('exitPreview')}
                >
                  ✕
                </button>
              </>
            ) : (
              <Select
                className="topbar-role-preview__select"
                value=""
                onChange={(e) => { if (e.target.value) startPreview(e.target.value as PreviewRole); }}
                title={t('previewSelectTitle')}
              >
                <option value="">{t('previewPlaceholder')}</option>
                {PREVIEW_ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </Select>
            )}
          </div>
        )}

        {/* Attention is workspace-scoped, so a person-level login alone is not
            sufficient while onboarding or before a workspace is selected. */}
        {hasTenant && <ManagerStatusIndicator />}

        {/* ONE control for the signed-in person, in the corner their eye already
            goes to. Alerts, chat, the cart, the theme, Settings and the way out
            were six buttons here; the badge on the avatar carries their combined
            count and the menu breaks it back down. See `AccountMenu`. */}
        <AccountMenu />

        {/* The surfaces those rows open. They are mounted by the SHELL rather
            than by the rows, because an open conversation or an open cart has to
            survive the menu closing — and, in the cart's case, a navigation. */}
        {isAuthenticated && <MessageHubPanel meId={user?.id ?? null} />}
        {isAuthenticated && <NotificationsPanel />}
        <ShoppingCart />

        {/* The shell is the same surface signed in or out (PRD 21 §0), so the way
            IN has to live in it — the marketing header used to carry this pair,
            and a guest on a canvas no longer sees that header. */}
        {!isAuthenticated && (
          <>
            <ThemeToggleButton />
            <ButtonLink href={signInHref(pathname)} variant="ghost" size="sm">{tc('signIn')}</ButtonLink>
            <ButtonLink href="/register" variant="primary" size="sm">{tc('getStarted')}</ButtonLink>
          </>
        )}
      </div>
    </header>
  );
}
