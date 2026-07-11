'use client';

import { Select } from '@/components/Select';

import Link from 'next/link';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { ThemeToggleButton } from '@/app/ThemeProvider';
import { useRolePreview, type PreviewRole } from '@/lib/RolePreviewContext';
import { useEmulation } from '@/lib/EmulationContext';
import { useCart } from '@/lib/CartContext';
import ShoppingCart from './ShoppingCart';
import NotificationBell from './NotificationBell';
import { ManagerStatusIndicator } from './ManagerStatusIndicator';
import { TenantProjectSwitcher } from './TenantProjectSwitcher';

const PREVIEW_ROLES: PreviewRole[] = ['owner', 'manager', 'developer', 'viewer'];

function CartButton() {
  const { count, openCart } = useCart();
  const t = useTranslations('topbar');
  return (
    <>
      <button
        type="button"
        onClick={openCart}
        title={t('cart')}
        style={{
          position: 'relative',
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          padding: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label={count > 0 ? t('cartWithCount', { count }) : t('cart')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>
        {count > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              background: '#6366f1',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
              lineHeight: 1,
            }}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      <ShoppingCart />
    </>
  );
}

export default function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const t = useTranslations('topbar');
  const { logout, user, isAuthenticated } = useAuth();
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
            <span aria-hidden="true">👁</span>
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
        <TenantProjectSwitcher />

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

        {isAuthenticated && <ManagerStatusIndicator />}

        {isAuthenticated && <NotificationBell />}

        <CartButton />

        <ThemeToggleButton />
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
