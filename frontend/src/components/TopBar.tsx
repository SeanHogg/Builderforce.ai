'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { ThemeToggleButton } from '@/app/ThemeProvider';

export default function TopBar() {
  const router = useRouter();
  const { user, tenant, logout } = useAuth();

  const handleSignOut = () => {
    logout();
    router.push('/');
  };

  return (
    <header className="topbar">
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
      <div className="topbar-right">
        <Link
          href="/brainstorm"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
            textDecoration: 'none',
            padding: '6px 10px',
            borderRadius: 8,
          }}
        >
          <span style={{ fontSize: '1rem' }}>🧠</span>
          Brain
        </Link>
        <Link href="/workforce" className="tenant-chip" style={{ textDecoration: 'none' }}>
          <span style={{ fontSize: '1rem' }}>🛒</span>
          Marketplace
        </Link>
        {tenant && (
          <Link href="/tenants" className="tenant-chip" style={{ textDecoration: 'none' }} title={tenant.name}>
            {tenant.name || tenant.id}
            <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </Link>
        )}
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
