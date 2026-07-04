'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ThemeToggleButton } from '@/app/ThemeProvider';
import { PRODUCT_SECTIONS } from '@/lib/content';
import { isNavItemActive } from '@/lib/nav';
import { useMobileNav } from '@/lib/useMobileNav';

/**
 * Horizontal top-of-page navigation for marketing / public pages (logged-out
 * visitors). This is the menu that — per the homepage redesign — moves OUT of
 * the left sidebar and INTO a header for every marketing page. Authenticated
 * users keep the left Sidebar instead (see ConditionalAppShell).
 *
 * Desktop: brand · inline links with hover/focus mega-menus · auth CTAs.
 * Mobile: brand · hamburger → full-screen drawer with the same links stacked.
 */

interface SimpleLink {
  href: string;
  label: string;
}

const RESOURCE_LINKS: SimpleLink[] = [
  { href: '/blog', label: 'Blog' },
  { href: '/tools', label: 'Diagnostics & Tools' },
  { href: '/prompts', label: 'Prompt Library' },
  { href: '/compare', label: 'Compare' },
  { href: '/integrations', label: 'Integrations' },
];

// Flat links that sit directly in the bar (no dropdown).
const FLAT_LINKS: SimpleLink[] = [
  // Talent (freelancers) + Workforce (AI agents/skills/personas) are one merged
  // marketplace surface now — a single nav entry, no separate /talent link.
  { href: '/marketplace', label: 'Talent / Workforce' },
  { href: '/agents', label: 'Agents' },
  // Evermind intentionally NOT a top-level flat link — it lives under the Product
  // mega-menu and in the footer; keeping it out of the bar reduces nav clutter.
  { href: '/models', label: 'Models' },
  { href: '/pricing', label: 'Pricing' },
];

// One active-link matcher shared with the Sidebar — no drift between surfaces.
const isActive = (pathname: string, href: string) =>
  isNavItemActive(pathname, { href, exactMatch: href === '/' });

/** The "Product" mega-menu panel — the product capability map (mirrors the
 *  authenticated Sidebar groupings via PRODUCT_SECTIONS). */
function ProductMenu({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="mh-mega">
      {PRODUCT_SECTIONS.map((section) => (
        <div key={section.id} className="mh-mega-col">
          <Link href={`/product#${section.id}`} className="mh-mega-head" onClick={onNavigate}>
            <span aria-hidden="true">{section.icon}</span> {section.title}
          </Link>
          {section.surfaces.map((s) => (
            <Link key={s.title} href={s.href} className="mh-mega-link" onClick={onNavigate}>
              <span className="mh-mega-link-icon" aria-hidden="true">{s.icon}</span>
              <span>{s.title}</span>
            </Link>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function MarketingHeader() {
  const pathname = usePathname() || '';
  const { open, openNav, closeNav } = useMobileNav();

  return (
    <header className="mh">
      <div className="mh-inner">
        {/* Brand */}
        <Link href="/" className="mh-brand" onClick={closeNav}>
          <Image
            src="/agentHost.png"
            alt="Builderforce"
            width={30}
            height={30}
            priority
            className="mh-brand-logo"
          />
          <span className="mh-brand-name">Builderforce.ai</span>
          <span className="mh-brand-badge">BETA</span>
        </Link>

        {/* Desktop nav */}
        <nav className="mh-nav" aria-label="Primary">
          <Link href="/" className={`mh-link${isActive(pathname, '/') ? ' active' : ''}`}>Home</Link>

          <div className="mh-item has-menu">
            <button type="button" className={`mh-link mh-trigger${pathname.startsWith('/product') ? ' active' : ''}`} aria-haspopup="true">
              Product
              <svg className="mh-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <div className="mh-panel mh-panel-wide">
              <ProductMenu />
            </div>
          </div>

          <div className="mh-item has-menu">
            <button type="button" className="mh-link mh-trigger" aria-haspopup="true">
              Resources
              <svg className="mh-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <div className="mh-panel">
              {RESOURCE_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="mh-panel-link">{l.label}</Link>
              ))}
            </div>
          </div>

          {FLAT_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={`mh-link${isActive(pathname, l.href) ? ' active' : ''}`}>
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Right side: theme + auth CTAs (desktop), hamburger (mobile) */}
        <div className="mh-right">
          <ThemeToggleButton />
          <Link href="/login" className="mh-signin">Sign In</Link>
          <Link href="/register" className="mh-cta">Get Started →</Link>
          <button type="button" className="mh-hamburger" onClick={open ? closeNav : openNav} aria-label="Toggle menu" aria-expanded={open}>
            {open ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      <div className={`mh-drawer${open ? ' open' : ''}`}>
        <Link href="/" className={`mh-drawer-link${isActive(pathname, '/') ? ' active' : ''}`} onClick={closeNav}>Home</Link>

        <div className="mh-drawer-group">
          <div className="mh-drawer-group-label">Product</div>
          {PRODUCT_SECTIONS.map((section) => (
            <Link key={section.id} href={`/product#${section.id}`} className="mh-drawer-link mh-drawer-sub" onClick={closeNav}>
              <span aria-hidden="true">{section.icon}</span> {section.title}
            </Link>
          ))}
        </div>

        {FLAT_LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={`mh-drawer-link${isActive(pathname, l.href) ? ' active' : ''}`} onClick={closeNav}>
            {l.label}
          </Link>
        ))}

        <div className="mh-drawer-group">
          <div className="mh-drawer-group-label">Resources</div>
          {RESOURCE_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="mh-drawer-link mh-drawer-sub" onClick={closeNav}>{l.label}</Link>
          ))}
        </div>

        <div className="mh-drawer-cta">
          <Link href="/login" className="mh-signin" onClick={closeNav}>Sign In</Link>
          <Link href="/register" className="mh-cta" onClick={closeNav}>Get Started →</Link>
        </div>
      </div>
      {open && <div className="mh-drawer-backdrop" onClick={closeNav} aria-hidden="true" />}
    </header>
  );
}
