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
import { ThemeToggleButton } from '@/app/ThemeProvider';
import { useRolePreview, type PreviewRole } from '@/lib/RolePreviewContext';
import { useEmulation } from '@/lib/EmulationContext';
import { HeaderCartButton } from './HeaderCartButton';
import { MessageHubButton, MessageHubPanel } from './messages/MessageHub';
import NotificationBell from './NotificationBell';
import { ManagerStatusIndicator } from './ManagerStatusIndicator';
import { TenantProjectSwitcher } from './TenantProjectSwitcher';
import { CommandPalette } from './workspace/CommandPalette';
import { OnboardingProgressPill } from './OnboardingProgressPill';
import { CanvasChromeSlotTarget } from '@/lib/canvas/CanvasChromeSlot';

const PREVIEW_ROLES: PreviewRole[] = ['owner', 'manager', 'developer', 'viewer'];

export default function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const t = useTranslations('topbar');
  const tc = useTranslations('common');
  const pathname = usePathname() || '';
  const { logout, user, isAuthenticated, hasTenant } = useAuth();
  const { previewRole, startPreview, exitPreview } = useRolePreview();
  const { emulation } = useEmulation();

  const handleSignOut = () => {
    logout();
    // Full page navigation so middleware and app see cleared cookies/tokens
    window.location.href = '/login';
  };

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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            {t('marketplace')}
          </Link>
        )}
      </div>
      <div className="topbar-right">
        {/* The board's own doors out — Make it real, Invite, Publish, the overflow —
            portalled up from the canvas so the window carries ONE bar of controls
            instead of this one and a second card floating just beneath it. The canvas
            still owns them; only the DOM position is ours. See `CanvasChromeSlot`.
            Empty, and collapsed by `:empty`, whenever no board is on the stage. */}
        <CanvasChromeSlotTarget className="canvas-chrome-slot" />
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
            complete/dismissed or for non-owner members. */}
        {isAuthenticated && <OnboardingProgressPill />}

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

        {isAuthenticated && <NotificationBell />}

        {/* Beside the cart, as asked: the two-way channel between an associate
            and the person who runs the programme. Self-gates to nothing when
            there is nobody this account may message. */}
        {isAuthenticated && <MessageHubButton />}
        {isAuthenticated && <MessageHubPanel meId={user?.id ?? null} />}

        <HeaderCartButton />

        <ThemeToggleButton />
        {/* The shell is the same surface signed in or out (PRD 21 §0), so the way
            IN has to live in it — the marketing header used to carry this pair,
            and a guest on a canvas no longer sees that header. */}
        {!isAuthenticated && (
          <>
            <ButtonLink href={signInHref(pathname)} variant="ghost" size="sm">{tc('signIn')}</ButtonLink>
            <ButtonLink href="/register" variant="primary" size="sm">{tc('getStarted')}</ButtonLink>
          </>
        )}
        {isAuthenticated && (
          <button
            type="button"
            onClick={handleSignOut}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={t('signOut')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
