'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/lib/AuthContext';
import { ThemeToggleButton } from '@/app/ThemeProvider';
import { useRolePreview, type PreviewRole } from '@/lib/RolePreviewContext';
import { useEmulation } from '@/lib/EmulationContext';
import { useCart } from '@/lib/CartContext';
import ShoppingCart from './ShoppingCart';

const PREVIEW_ROLES: PreviewRole[] = ['owner', 'manager', 'developer', 'viewer'];

function CartButton() {
  const { count, openCart } = useCart();
  return (
    <>
      <button
        type="button"
        onClick={openCart}
        title="Shopping cart"
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
        aria-label={count > 0 ? `Shopping cart, ${count} item${count !== 1 ? 's' : ''}` : 'Shopping cart'}
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

export default function TopBar() {
  const { tenant, logout, user } = useAuth();
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
        <Link href="/dashboard" className="brand" style={{ textDecoration: 'none' }}>
          <Image
            src="/claw.png"
            alt="Builderforce"
            width={28}
            height={28}
            className="brand-logo"
            style={{ filter: 'drop-shadow(0 0 8px var(--logo-glow))' }}
          />
          <span className="brand-name">Builderforce.ai</span>
          <span className="brand-badge">BETA</span>
        </Link>
      </div>
      <div className="topbar-center">
        {previewRole ? (
          <span className="topbar-preview-info">
            <span aria-hidden="true">👁</span>
            Previewing as <strong>{previewRole}</strong> — frontend-only, no API calls affected
          </span>
        ) : (
          <Link href="/marketplace" className="tenant-chip topbar-center-link" style={{ textDecoration: 'none' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            Marketplace
          </Link>
        )}
      </div>
      <div className="topbar-right">
        {tenant && (
          <Link href="/tenants" className="tenant-chip" style={{ textDecoration: 'none' }} title={tenant.name}>
            {tenant.name || tenant.id}
            <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </Link>
        )}

        {/* Role preview — superadmin only, not during emulation */}
        {user?.isSuperadmin && !emulation && (
          <div className="topbar-role-preview">
            {previewRole ? (
              <>
                <span className="topbar-role-preview__badge">
                  Preview: {previewRole}
                </span>
                <button
                  type="button"
                  className="topbar-role-preview__exit"
                  onClick={exitPreview}
                  title="Exit role preview"
                >
                  ✕
                </button>
              </>
            ) : (
              <select
                className="topbar-role-preview__select"
                value=""
                onChange={(e) => { if (e.target.value) startPreview(e.target.value as PreviewRole); }}
                title="Preview as role (frontend-only)"
              >
                <option value="">Preview role…</option>
                {PREVIEW_ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            )}
          </div>
        )}

        <CartButton />

        <ThemeToggleButton />
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
          title="Sign out"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </header>
  );
}
