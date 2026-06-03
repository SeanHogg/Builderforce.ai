'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ThemeToggleButton } from '@/app/ThemeProvider';
import { useModalDismiss } from '@/hooks/useModalDismiss';
import { isNavItemActive } from '@/lib/nav';

export interface MarketingNavLink {
  label: string;
  href: string;
}

interface MarketingHeaderProps {
  /** Right-side nav links (everything except the Get Started CTA). */
  links: MarketingNavLink[];
  /** CTA shown in the header on every breakpoint. */
  ctaLabel?: string;
  ctaHref?: string;
}

/**
 * Shared sticky header for the Builderforce marketing pages (landing, blog).
 *
 * Responsive behaviour: on desktop all links + theme toggle + CTA render inline.
 * On mobile the links and theme toggle collapse into a slide-out menu behind a
 * hamburger button; the Get Started CTA always stays visible in the header.
 *
 * Links decide their own active state from `usePathname()`, so consumers just
 * pass the link list — no prop-drilled active flags.
 */
export default function MarketingHeader({
  links,
  ctaLabel = 'Get Started Free →',
  ctaHref = '/register',
}: MarketingHeaderProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => isNavItemActive(pathname, { href });

  // Lock body scroll + close on Escape while the menu is open.
  useModalDismiss(open, () => setOpen(false));

  return (
    <header className="mh-nav" aria-label="Main navigation">
      <div className="mh-nav-inner">
        <Link href="/" className="mh-nav-logo">
          <Image src="/agentHost.png" alt="" width={32} height={32} priority />
          Builderforce.ai
        </Link>

        <div className="mh-nav-right">
          {/* Desktop: inline links + theme toggle (hidden on mobile) */}
          <div className="mh-desktop">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`mh-nav-link${isActive(l.href) ? ' active' : ''}`}
              >
                {l.label}
              </Link>
            ))}
            <ThemeToggleButton />
          </div>

          {/* CTA — always visible */}
          <Link href={ctaHref} className="mh-nav-cta">
            {ctaLabel}
          </Link>

          {/* Mobile: hamburger (hidden on desktop) */}
          <button
            type="button"
            className="mh-hamburger"
            aria-label="Open menu"
            aria-expanded={open}
            aria-controls="mh-mobile-menu"
            onClick={() => setOpen(true)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Slide-out menu + backdrop */}
      <div
        className={`mh-backdrop${open ? ' open' : ''}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside
        id="mh-mobile-menu"
        className={`mh-menu${open ? ' open' : ''}`}
        aria-hidden={!open}
      >
        <div className="mh-menu-head">
          <span className="mh-menu-title">Menu</span>
          <button
            type="button"
            className="mh-menu-close"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
        <nav className="mh-menu-links">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`mh-menu-link${isActive(l.href) ? ' active' : ''}`}
              onClick={() => setOpen(false)}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="mh-menu-foot">
          <span className="mh-menu-foot-label">Theme</span>
          <ThemeToggleButton />
        </div>
      </aside>

      <style>{`
        .mh-nav {
          position: sticky;
          top: 0;
          z-index: 100;
          border-bottom: 1px solid var(--border-subtle);
          background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        .mh-nav-inner {
          max-width: 1100px;
          margin: 0 auto;
          padding: 0 24px;
          height: 62px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }
        .mh-nav-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 1.1rem;
          color: var(--text-primary);
        }
        .mh-nav-logo img {
          width: 32px;
          height: 32px;
          object-fit: contain;
          filter: drop-shadow(0 0 10px var(--logo-glow));
          transition: filter 0.3s ease, transform 0.35s cubic-bezier(0.34,1.56,0.64,1);
        }
        .mh-nav-logo:hover img {
          filter: drop-shadow(0 0 18px var(--logo-glow-hover));
          transform: scale(1.12) rotate(-6deg);
        }
        .mh-nav-right {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .mh-desktop {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .mh-nav-link {
          font-size: 0.875rem;
          color: var(--text-secondary);
          text-decoration: none;
          padding: 6px 12px;
          border-radius: 8px;
          transition: color 0.2s ease, background 0.2s ease;
        }
        .mh-nav-link:hover,
        .mh-nav-link.active {
          color: var(--text-primary);
          background: var(--surface-interactive);
        }
        .mh-nav-cta {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 8px 18px;
          border-radius: 10px;
          background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark));
          color: #fff;
          font-family: var(--font-display);
          font-weight: 600;
          font-size: 0.875rem;
          text-decoration: none;
          white-space: nowrap;
          box-shadow: 0 4px 14px var(--shadow-coral-mid);
          transition: all 0.25s ease;
        }
        .mh-nav-cta:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 22px var(--shadow-coral-strong);
        }
        .mh-hamburger {
          display: none;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          padding: 0;
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          background: var(--surface-interactive, transparent);
          color: var(--text-primary);
          cursor: pointer;
          transition: background 0.2s ease;
        }
        .mh-hamburger:hover { background: var(--surface-interactive); }

        /* ── Slide-out menu ── */
        .mh-backdrop {
          position: fixed;
          inset: 0;
          z-index: 200;
          background: rgba(0,0,0,0.5);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.25s ease;
        }
        .mh-backdrop.open { opacity: 1; pointer-events: auto; }
        .mh-menu {
          position: fixed;
          top: 0;
          right: 0;
          z-index: 201;
          height: 100dvh;
          width: min(82vw, 320px);
          display: flex;
          flex-direction: column;
          background: var(--bg-surface);
          border-left: 1px solid var(--border-subtle);
          box-shadow: -12px 0 40px rgba(0,0,0,0.35);
          transform: translateX(100%);
          transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
        }
        .mh-menu.open { transform: translateX(0); }
        .mh-menu-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 62px;
          padding: 0 16px 0 20px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .mh-menu-title {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.95rem;
          color: var(--text-primary);
        }
        .mh-menu-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border: none;
          border-radius: 10px;
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          transition: background 0.2s ease, color 0.2s ease;
        }
        .mh-menu-close:hover { background: var(--surface-interactive); color: var(--text-primary); }
        .mh-menu-links {
          display: flex;
          flex-direction: column;
          padding: 12px;
          gap: 2px;
          overflow-y: auto;
        }
        .mh-menu-link {
          font-size: 1rem;
          color: var(--text-secondary);
          text-decoration: none;
          padding: 12px 14px;
          border-radius: 10px;
          transition: color 0.2s ease, background 0.2s ease;
        }
        .mh-menu-link:hover,
        .mh-menu-link.active {
          color: var(--text-primary);
          background: var(--surface-interactive);
        }
        .mh-menu-foot {
          margin-top: auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-top: 1px solid var(--border-subtle);
        }
        .mh-menu-foot-label {
          font-size: 0.875rem;
          color: var(--text-muted);
        }

        @media (max-width: 820px) {
          .mh-desktop { display: none; }
          .mh-hamburger { display: inline-flex; }
          .mh-nav-inner { padding: 0 16px; }
        }
      `}</style>
    </header>
  );
}
