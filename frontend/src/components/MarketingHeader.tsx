'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ThemeToggleButton } from '@/app/ThemeProvider';
import {
  LEARN_COLUMNS,
  PRODUCT_COLUMNS,
  PUBLIC_NAV,
  columnOf,
  destTaglineKey,
  destTitleKey,
  type MenuColumn,
  type PublicDestination,
} from '@/lib/navGroups';
import { seatHueVar } from '@/lib/seats';
import { isNavItemActive } from '@/lib/nav';
import { useMobileNav } from '@/lib/useMobileNav';
import { Icon } from '@/components/ui/Icon';
import { HeaderCartButton } from './HeaderCartButton';

/**
 * Horizontal top-of-page navigation for marketing / public pages (PRD 21 §11.4.6).
 *
 * It is a RENDERER of the registry, not a fourth list: the Product mega-menu is
 * `REFERENCE_DOMAINS` / `REFERENCE_FOUNDATIONS` from `navGroups`, which is the
 * same array the features page and the app rail read. A marketing page therefore
 * cannot describe a capability under a name the product does not use.
 *
 * Two corrections it carries, both from the 2026-08-09 operator review:
 *
 *  1. **No `Home` item.** The logo already is home; a separate entry was the
 *     second way to do the one thing every logo in every product does.
 *  2. **The primary CTA opens the canvas, not a signup form.** The board is real,
 *     local-first and theirs before an account exists (`/create/new` is in
 *     `GUEST_APP_PATTERNS`, so a signed-out visitor gets the operator shell and a
 *     genuine session). A wall in front of a product that works without one
 *     spends the acquisition cost on the form instead of on the product.
 *
 * Agents are gone from the bar too — an agent is a marketplace *listing* whose
 * purchase writes a roster row (§11.5), so it is a family inside Marketplace and
 * never a destination of its own.
 *
 * Desktop: brand · inline links with hover/focus mega-menus · auth CTAs.
 * Mobile: brand · hamburger → full-screen drawer with the same links stacked.
 */

// One active-link matcher shared with the Sidebar — no drift between surfaces.
const isActive = (pathname: string, href: string) =>
  isNavItemActive(pathname, { href, exactMatch: href === '/' });

/** One row of a mega-menu — title, one line of what it is for, and the owning
 *  seat's own hue on the marker, so the menu, the features card and the roster
 *  chip agree about who is behind the domain. */
function MegaLink({ entry, onNavigate }: { entry: PublicDestination; onNavigate?: () => void }) {
  const t = useTranslations();
  return (
    <Link href={entry.marketingHref} className="mh-mega-link" onClick={onNavigate}>
      <span
        className="mh-mega-link-icon"
        aria-hidden="true"
        style={{ '--seat': `var(${seatHueVar(entry.seat)})` } as React.CSSProperties}
      >
        <Icon source={entry.icon} size={18} />
      </span>
      <span className="mh-mega-link-body">
        <strong>{t(destTitleKey(entry))}</strong>
        <small>{t(destTaglineKey(entry))}</small>
      </span>
    </Link>
  );
}

/**
 * A mega-menu: one column per group, each a projection of `PUBLIC_DESTINATIONS`.
 *
 * ONE component for both menus, because "Learn is the same way" — Product ▾ and
 * Learn ▾ differ only in which columns they read, and building the second one by
 * hand as a flat list of links is exactly why they stopped matching.
 *
 * The column heading carries its stage dot, so the public menu teaches the same
 * Idea → Make → Run vocabulary the signed-in rail uses. Somebody who reads the
 * marketing menu and then signs up finds the shape they were shown.
 */
function MegaMenu({
  columns,
  footNoteKey,
  onNavigate,
}: {
  columns: readonly MenuColumn[];
  footNoteKey: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations();
  const tm = useTranslations('marketingNav');
  return (
    <div className="mh-mega">
      {columns.map((column) => (
        <div key={column} className="mh-mega-col">
          <h4 className="mh-mega-head" style={{ '--stage': `var(--stage-${column})` } as React.CSSProperties}>
            <i aria-hidden="true" />
            {tm(`column.${column}`)}
          </h4>
          {columnOf(column).map((entry) => (
            <MegaLink key={entry.id} entry={entry} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
      {/* The promise the whole IA rests on, said once where a reader can check
          it: these are real URLs signed out and panels over your board signed
          in. One implementation, two shells. */}
      <p className="mh-mega-foot">{t(footNoteKey)}</p>
    </div>
  );
}

export default function MarketingHeader() {
  const pathname = usePathname() || '';
  const { open, openNav, closeNav } = useMobileNav();
  const t = useTranslations('marketingNav');
  // Destination titles resolve by FULL path, because a row's copy lives either
  // under `burnrateMarketing.domains.*` (the nine translated domain explainers)
  // or under `marketingNav.dest.*`. `destTitleKey` decides which; the renderer
  // does not need to know, and cannot get it wrong.
  const tRoot = useTranslations();
  // Sign In is the SAME offer the operator shell's TopBar makes to a signed-out
  // visitor, so the copy lives in `common.*` once rather than twice. The primary
  // CTA does NOT: it is the canvas offer, and it is this header's own.
  const tc = useTranslations('common');

  return (
    <header className="mh">
      <div className="mh-inner">
        {/* Brand. This IS the Home link — there is no second one. */}
        <Link href="/" className="mh-brand" onClick={closeNav} aria-label={t('home')}>
          <Image
            src="/agentHost.png"
            alt=""
            width={30}
            height={30}
            priority
            className="mh-brand-logo"
          />
          <span className="mh-brand-name">Builderforce.ai</span>
          <span className="mh-brand-badge">{t('beta')}</span>
        </Link>

        {/* Desktop nav */}
        <nav className="mh-nav" aria-label={t('primaryNav')}>
          <div className="mh-item has-menu">
            <button type="button" className={`mh-link mh-trigger${pathname.startsWith('/product') ? ' active' : ''}`} aria-haspopup="true">
              {t('product')}
              <svg className="mh-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <div className="mh-panel mh-panel-wide">
              <MegaMenu columns={PRODUCT_COLUMNS} footNoteKey="marketingNav.megaFoot" />
            </div>
          </div>

          <div className="mh-item has-menu">
            <button type="button" className="mh-link mh-trigger" aria-haspopup="true">
              {t('learn')}
              <svg className="mh-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            <div className="mh-panel mh-panel-wide">
              <MegaMenu columns={LEARN_COLUMNS} footNoteKey="marketingNav.megaFootLearn" />
            </div>
          </div>

          {PUBLIC_NAV.map((l) => (
            <Link key={l.id} href={l.marketingHref} className={`mh-link${isActive(pathname, l.marketingHref) ? ' active' : ''}`}>
              {tRoot(destTitleKey(l))}
            </Link>
          ))}
        </nav>

        {/* Right side: theme + auth CTAs (desktop), hamburger (mobile) */}
        <div className="mh-right">
          <HeaderCartButton className="mh-cart" />
          <ThemeToggleButton />
          <Link href="/login" className="mh-signin">{tc('signIn')}</Link>
          <Link href="/create/new" className="mh-cta">{t('openCanvas')}</Link>
          <button type="button" className="mh-hamburger" onClick={open ? closeNav : openNav} aria-label={t('toggleMenu')} aria-expanded={open}>
            {open ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile drawer — the same columns, stacked. A phone gets the whole map
          too: the drawer used to flatten Product into one undifferentiated list,
          which is the version of the menu that taught nobody the arc. */}
      <div className={`mh-drawer${open ? ' open' : ''}`}>
        {[...PRODUCT_COLUMNS, ...LEARN_COLUMNS].map((column) => (
          <div key={column} className="mh-drawer-group">
            <div className="mh-drawer-group-label" style={{ '--stage': `var(--stage-${column})` } as React.CSSProperties}>
              {t(`column.${column}`)}
            </div>
            {columnOf(column).map((entry) => (
              <Link
                key={entry.id}
                href={entry.marketingHref}
                className="mh-drawer-link mh-drawer-sub"
                onClick={closeNav}
                style={{ '--seat': `var(${seatHueVar(entry.seat)})` } as React.CSSProperties}
              >
                <Icon source={entry.icon} size={17} /> {tRoot(destTitleKey(entry))}
              </Link>
            ))}
          </div>
        ))}

        {PUBLIC_NAV.map((l) => (
          <Link key={l.id} href={l.marketingHref} className={`mh-drawer-link${isActive(pathname, l.marketingHref) ? ' active' : ''}`} onClick={closeNav}>
            {tRoot(destTitleKey(l))}
          </Link>
        ))}

        <div className="mh-drawer-cta">
          <Link href="/login" className="mh-signin" onClick={closeNav}>{tc('signIn')}</Link>
          <Link href="/create/new" className="mh-cta" onClick={closeNav}>{t('openCanvas')}</Link>
        </div>
      </div>
      {open && <div className="mh-drawer-backdrop" onClick={closeNav} aria-hidden="true" />}
    </header>
  );
}
