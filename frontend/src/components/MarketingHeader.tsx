'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ThemeToggleButton } from '@/app/ThemeProvider';
import {
  LEARN_COLUMNS,
  PRODUCT_STAGES,
  PUBLIC_NAV,
  columnOf,
  destTaglineKey,
  destTitleKey,
  productFacesFor
} from '@/lib/publicDestinations';
import { seatHueVar, type SeatOrPlatform } from '@/lib/seats';
import { isNavItemActive } from '@/lib/nav';
import { rendersAppShell } from '@/lib/shellRouting';
import { useMobileNav } from '@/lib/useMobileNav';
import { listLocalCreationSessions } from '@/lib/creationSessions';
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
interface MegaRow {
  id: string;
  href: string;
  icon: string;
  seat: SeatOrPlatform;
  /** Full-path i18n keys — a row's copy lives in one of three namespaces and the
   *  renderer must not need to know which. */
  titleKey: string;
  taglineKey: string;
}

function MegaLink({ row, onNavigate }: { row: MegaRow; onNavigate?: () => void }) {
  const t = useTranslations();
  return (
    <Link href={row.href} className="mh-mega-link" onClick={onNavigate}>
      <span
        className="mh-mega-link-icon"
        aria-hidden="true"
        style={{ '--seat': `var(${seatHueVar(row.seat)})` } as React.CSSProperties}
      >
        <Icon source={row.icon} size={18} />
      </span>
      <span className="mh-mega-link-body">
        <strong>{t(row.titleKey)}</strong>
        <small>{t(row.taglineKey)}</small>
      </span>
    </Link>
  );
}

/** The Product menu: the RAIL, stage by stage. Same rows, same names, same
 *  order as the left panel — which is the whole point of it. */
function productColumns(): MegaColumn[] {
  return PRODUCT_STAGES.map((stage) => ({
    key: stage,
    headingKey: `nav.stage.${stage}`,
    stageVar: `--stage-${stage}`,
    rows: productFacesFor(stage).map((face) => ({
      id: face.group.id,
      href: face.href,
      icon: face.group.icon,
      seat: face.group.seat,
      titleKey: `nav.${face.titleKey}`,
      taglineKey: face.taglineKey,
    })),
  }));
}

/** The Learn menu: the public pages that are not the product itself. */
function learnColumns(): MegaColumn[] {
  return LEARN_COLUMNS.map((column) => ({
    key: column,
    headingKey: `marketingNav.column.${column}`,
    stageVar: `--stage-${column}`,
    rows: columnOf(column).map((entry) => ({
      id: entry.id,
      href: entry.marketingHref,
      icon: entry.icon,
      seat: entry.seat,
      titleKey: destTitleKey(entry),
      taglineKey: destTaglineKey(entry),
    })),
  }));
}

interface MegaColumn {
  key: string;
  headingKey: string;
  stageVar: string;
  rows: MegaRow[];
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
/**
 * How many grid tracks a column takes.
 *
 * The registry is not balanced and should not be forced to be: Run owns eight
 * business seats while Idea owns two, because that is the truth about the
 * product. Rendering that truth as one 8-deep column beside two 2-deep ones
 * gave a menu with a long ragged leg. A column wider than five rows takes two
 * tracks and flows its rows down them instead — the shape follows the content
 * rather than the content being trimmed to fit the shape.
 */
const MAX_ROWS_PER_TRACK = 5;
const tracksFor = (rows: number) => Math.min(2, Math.max(1, Math.ceil(rows / MAX_ROWS_PER_TRACK)));

function MegaMenu({
  columns,
  footNoteKey,
  onNavigate,
}: {
  columns: MegaColumn[];
  footNoteKey: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations();
  const tracks = columns.reduce((total, { rows }) => total + tracksFor(rows.length), 0);

  return (
    <div className="mh-mega" style={{ '--mega-tracks': tracks } as React.CSSProperties}>
      {columns.map((column) => (
        <div
          key={column.key}
          className="mh-mega-col"
          style={{
            '--stage': `var(${column.stageVar})`,
            '--track-span': tracksFor(column.rows.length),
          } as React.CSSProperties}
        >
          <h4 className="mh-mega-head">
            <i aria-hidden="true" />
            {t(column.headingKey)}
          </h4>
          <div className="mh-mega-rows">
            {column.rows.map((row) => (
              <MegaLink key={row.id} row={row} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
      {/* The promise the whole IA rests on, said once where a reader can check
          it: these are real URLs signed out and panels over your board signed
          in. One implementation, two shells. */}
      <p className="mh-mega-foot">{t(footNoteKey)}</p>
    </div>
  );
}

type MenuId = 'product' | 'learn';

/**
 * A top-level menu and the panel it opens.
 *
 * The menu used to be CSS-only — `:hover` / `:focus-within` on the wrapper, with
 * the panel offset `6px` below the trigger. Two things were wrong with that, and
 * both were reported from the running app:
 *
 *  1. **The gap ate the pointer.** Six pixels of nothing sat between the trigger
 *     and the panel, and `:hover` is false in a gap — so moving down towards an
 *     item closed the menu before the pointer reached it. The panel is flush now
 *     and its breathing room is padding INSIDE it, which is hoverable.
 *  2. **Clicking did nothing, and neither did a keyboard or a touchscreen.** A
 *     hover-only menu has no open state to speak of: the button carried
 *     `aria-haspopup` and no `aria-expanded`, because there was nothing to
 *     expand. It is a real disclosure now — click to toggle, Escape to close,
 *     click-outside to close — and hover still opens it for a pointer, so the
 *     fast path is unchanged for the people who had one.
 */
function MegaTrigger({
  id, label, open, onToggle, active, children,
}: {
  id: MenuId;
  label: string;
  open: boolean;
  onToggle: (id: MenuId) => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mh-item has-menu" data-open={open || undefined}>
      <button
        type="button"
        className={`mh-link mh-trigger${active ? ' active' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        {label}
        <svg className="mh-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      <div className="mh-panel mh-panel-wide">{children}</div>
    </div>
  );
}

export default function MarketingHeader() {
  const pathname = usePathname() || '';
  const { open, openNav, closeNav } = useMobileNav();
  const [menu, setMenu] = useState<MenuId | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);
  const toggleMenu = useCallback((id: MenuId) => setMenu((current) => (current === id ? null : id)), []);

  // A menu that only closes on its own trigger is a menu that follows you around
  // the page. Escape and a click outside are the two exits every disclosure owes.
  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeMenu(); };
    const onPointer = (event: MouseEvent) => {
      if (!navRef.current?.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [menu, closeMenu]);

  // Following a link inside the panel must leave it shut behind you.
  useEffect(() => { setMenu(null); }, [pathname]);

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

  // "Open the canvas" is an invitation into the product, so it has nothing to
  // say to somebody already standing in it. This header now renders inside the
  // operator shell for logged-out visitors (AppShell), and there the CTA pointed
  // at `/create/new` — a route that MINTS A NEW SESSION, so the most prominent
  // control on a guest's own board was "throw this board away and start again".
  const inProduct = rendersAppShell(pathname, false);

  /**
   * Whether THIS browser already has real canvas work — checked once and held in
   * state rather than on every render, since `listLocalCreationSessions` scans
   * every `localStorage` key. Only meaningful `inProduct`; a marketing page keeps
   * its unconditional "Open the canvas" invitation regardless of what some OTHER
   * tab's guest board holds.
   *
   * ── WHY THE CTA CHANGES AT ALL ────────────────────────────────────────────────
   * "Get Started" is an invitation; once there is a real, local-first board behind
   * it, the honest offer is "keep this", not "start something" — the offer only
   * exists once there is something to lose, and it replaces the bottom-left
   * "Sign in to keep your work" strip this same review removed from the rail.
   */
  const [hasLocalWork, setHasLocalWork] = useState(false);
  useEffect(() => {
    if (!inProduct) { setHasLocalWork(false); return; }
    setHasLocalWork(listLocalCreationSessions().length > 0);
  }, [inProduct, pathname]);
  const keepingWork = inProduct && hasLocalWork;

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
        <nav className="mh-nav" aria-label={t('primaryNav')} ref={navRef}>
          <MegaTrigger
            id="product"
            label={t('product')}
            open={menu === 'product'}
            onToggle={toggleMenu}
            active={pathname.startsWith('/product')}
          >
            <MegaMenu columns={productColumns()} footNoteKey="marketingNav.megaFoot" onNavigate={closeMenu} />
          </MegaTrigger>

          <MegaTrigger id="learn" label={t('learn')} open={menu === 'learn'} onToggle={toggleMenu}>
            <MegaMenu columns={learnColumns()} footNoteKey="marketingNav.megaFootLearn" onNavigate={closeMenu} />
          </MegaTrigger>

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
          {inProduct
            ? <Link href="/register" className={`mh-cta${keepingWork ? ' mh-cta-keep' : ''}`}>{tc(keepingWork ? 'keepYourWork' : 'getStarted')}</Link>
            : <Link href="/create/new" className="mh-cta">{t('openCanvas')}</Link>}
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
        {[...productColumns(), ...learnColumns()].map((column) => (
          <div key={column.key} className="mh-drawer-group">
            <div className="mh-drawer-group-label" style={{ '--stage': `var(${column.stageVar})` } as React.CSSProperties}>
              {tRoot(column.headingKey)}
            </div>
            {column.rows.map((row) => (
              <Link
                key={row.id}
                href={row.href}
                className="mh-drawer-link mh-drawer-sub"
                onClick={closeNav}
                style={{ '--seat': `var(${seatHueVar(row.seat)})` } as React.CSSProperties}
              >
                <Icon source={row.icon} size={17} /> {tRoot(row.titleKey)}
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
          {inProduct
            ? <Link href="/register" className={`mh-cta${keepingWork ? ' mh-cta-keep' : ''}`} onClick={closeNav}>{tc(keepingWork ? 'keepYourWork' : 'getStarted')}</Link>
            : <Link href="/create/new" className="mh-cta" onClick={closeNav}>{t('openCanvas')}</Link>}
        </div>
      </div>
      {open && <div className="mh-drawer-backdrop" onClick={closeNav} aria-hidden="true" />}
    </header>
  );
}
