'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ThemeToggleButton } from '@/app/ThemeProvider';
import { useModalDismiss } from '@/hooks/useModalDismiss';
import { isNavItemActive } from '@/lib/nav';
import type { NavLink } from '@/lib/content';

interface MarketingHeaderProps {
  /** Right-side nav links (everything except the Get Started CTA). */
  links: NavLink[];
  /** CTA shown in the header on every breakpoint. */
  ctaLabel?: string;
  ctaHref?: string;
}

/**
 * Desktop nav item that owns a mega-menu. The label stays a real link (to the
 * full tour at `item.href`); the panel opens on hover/focus and lists every
 * product surface so visitors see what the platform consists of without leaving
 * the page. Self-contained — manages its own open state.
 */
function MegaItem({ item, active }: { item: NavLink; active: boolean }) {
  const [open, setOpen] = useState(false);
  const sections = item.menu ?? [];

  return (
    <div
      className="mh-mega-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <Link
        href={item.href}
        className={`mh-nav-link mh-mega-trigger${active ? ' active' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(false)}
      >
        {item.label}
        <svg className="mh-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </Link>

      <div className={`mh-mega${open ? ' open' : ''}`} role="menu">
        <div className="mh-mega-grid">
          {sections.map((sec) => (
            <div key={sec.id} className="mh-mega-col">
              <div className="mh-mega-col-title">{sec.title}</div>
              {sec.surfaces.map((s) => (
                <Link key={s.title} href={s.href} className="mh-mega-link" role="menuitem" onClick={() => setOpen(false)}>
                  <span className="mh-mega-ico">{s.icon}</span>
                  <span className="mh-mega-txt">
                    <span className="mh-mega-name">{s.title}</span>
                    <span className="mh-mega-desc">{s.desc}</span>
                  </span>
                </Link>
              ))}
            </div>
          ))}
        </div>
        <Link href={item.href} className="mh-mega-foot" onClick={() => setOpen(false)}>
          See the full product tour →
        </Link>
      </div>
    </div>
  );
}

/**
 * Shared sticky header for the Builderforce marketing pages (landing, blog,
 * product). Responsive: on desktop all links + theme toggle + CTA render inline,
 * with mega-menu items opening a dropdown; on mobile everything collapses into a
 * slide-out where mega-menu items expand their sections inline. The Get Started
 * CTA stays visible at every breakpoint.
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
  const close = () => setOpen(false);

  // Lock body scroll + close on Escape while the menu is open.
  useModalDismiss(open, close);

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
            {links.map((l) =>
              l.menu ? (
                <MegaItem key={l.href} item={l} active={isActive(l.href)} />
              ) : (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`mh-nav-link${isActive(l.href) ? ' active' : ''}`}
                >
                  {l.label}
                </Link>
              ),
            )}
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
        onClick={close}
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
            onClick={close}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
        <nav className="mh-menu-links">
          {links.map((l) => (
            <div key={l.href} className="mh-mobile-group">
              <Link
                href={l.href}
                className={`mh-menu-link${isActive(l.href) ? ' active' : ''}`}
                onClick={close}
              >
                {l.label}
              </Link>
              {l.menu && (
                <div className="mh-msec">
                  {l.menu.map((sec) => (
                    <div key={sec.id} className="mh-msec-block">
                      <div className="mh-msec-title">{sec.title}</div>
                      {sec.surfaces.map((s) => (
                        <Link key={s.title} href={s.href} className="mh-msec-link" onClick={close}>
                          <span aria-hidden="true">{s.icon}</span>
                          {s.title}
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
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

        /* ── Desktop mega-menu ── */
        .mh-mega-wrap { position: relative; display: inline-flex; }
        .mh-mega-trigger { display: inline-flex; align-items: center; gap: 4px; }
        .mh-caret { transition: transform 0.2s ease; opacity: 0.7; }
        .mh-mega-wrap:hover .mh-caret { transform: rotate(180deg); }
        .mh-mega {
          position: absolute;
          top: calc(100% + 10px);
          left: 50%;
          transform: translateX(-50%) translateY(6px);
          width: min(720px, 92vw);
          padding: 16px;
          border-radius: 16px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          box-shadow: 0 24px 60px rgba(0,0,0,0.35);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.18s ease, transform 0.18s ease;
          z-index: 150;
        }
        .mh-mega.open { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0); }
        .mh-mega-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 14px; }
        @media (min-width: 1180px) { .mh-mega-grid { grid-template-columns: repeat(4, 1fr); } }
        .mh-mega-col { display: flex; flex-direction: column; }
        .mh-mega-col-title {
          font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--text-muted); padding: 8px 8px 4px;
        }
        .mh-mega-link { display: flex; gap: 10px; padding: 8px; border-radius: 10px; text-decoration: none; transition: background 0.15s ease; }
        .mh-mega-link:hover { background: var(--surface-interactive); }
        .mh-mega-ico { font-size: 1.05rem; line-height: 1.3; flex-shrink: 0; }
        .mh-mega-txt { display: flex; flex-direction: column; min-width: 0; }
        .mh-mega-name { font-size: 0.85rem; font-weight: 600; color: var(--text-primary); }
        .mh-mega-desc { font-size: 0.73rem; color: var(--text-muted); line-height: 1.35; }
        .mh-mega-foot {
          display: inline-block; margin: 8px 4px 0; padding: 8px;
          font-size: 0.82rem; font-weight: 600; color: var(--coral-bright); text-decoration: none;
        }
        .mh-mega-foot:hover { text-decoration: underline; }

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
          width: min(86vw, 360px);
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
          flex-shrink: 0;
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
        .mh-mobile-group { display: flex; flex-direction: column; }
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
        .mh-msec {
          display: flex;
          flex-direction: column;
          margin: 2px 0 8px 8px;
          padding-left: 8px;
          border-left: 2px solid var(--border-subtle);
        }
        .mh-msec-title {
          font-size: 0.66rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--text-muted); padding: 10px 12px 2px;
        }
        .mh-msec-link {
          display: flex; align-items: center; gap: 9px;
          padding: 9px 12px; border-radius: 8px;
          font-size: 0.92rem; color: var(--text-secondary); text-decoration: none;
          transition: color 0.2s ease, background 0.2s ease;
        }
        .mh-msec-link:hover { color: var(--text-primary); background: var(--surface-interactive); }
        .mh-menu-foot {
          margin-top: auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-top: 1px solid var(--border-subtle);
          flex-shrink: 0;
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
