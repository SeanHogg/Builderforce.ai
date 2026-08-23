'use client';

import { Icon } from '@/components/ui/Icon';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import {
  STAGES,
  findActiveGroup,
  groupsForStage,
  type NavGroup,
  type Stage,
} from '@/lib/navGroups';
import { destinationReachable } from '@/lib/shellRouting';
import { isSeat, seatHueVar } from '@/lib/seats';
import { signInHref } from '@/lib/auth';
import { ButtonLink } from '@/components/ui';
import SessionList from './SessionList';
import { NavIcon } from './navigation/NavIcon';
import { isStageRoute } from '@/lib/workbenchPolicy';
import { useNavGroups } from '@/lib/destinations/useDestinations';
import { LegalStrip } from './legal/LegalStrip';
import UsageMeter from './UsageMeter';

/**
 * The left panel — the ARC (PRD 21 §3.2, §11.4.1).
 *
 * It leads with **sessions** (New, Active, Recents), then groups every
 * destination by its `stage`: Idea → Make → Run, plus Measure, Market and Admin.
 * That ordering answers *where am I in the journey*, which is the only question
 * a first-time visitor can actually ask — a department list answers a question
 * only an employee has.
 *
 * Three things it deliberately no longer does:
 *
 *  1. **No second rail.** It used to render `BURNRATE_PRODUCT_DOMAINS` under a
 *     "Product domains" heading, whose nine rows navigated OUT of the product
 *     into marketing pages while the footer simultaneously showed a different
 *     roster of the same seats. Those rows are now the RUN group, under their
 *     product names with the seat as a trailing chip in that seat's own hue.
 *  2. **No `Seat` item.** `/seat/delivery` as a menu entry was a door labelled
 *     *door*; the RUN rows and the footer chips are how a seat is reached.
 *  3. **No `Dashboard` item.** §6.8 already lands sign-in on the last board, and
 *     a Dashboard entry is the thing that undoes it.
 *
 * Every stage header collapses and remembers it, because with PRD 18/19 landed
 * the RUN group alone carries eight rows and somebody who lives in Make should
 * not scroll past a company they touch on Fridays. Collapse is a click, never a
 * hover: the stage underneath is a drag surface and a hover-opened region at the
 * left edge eats drags.
 *
 * Sub-views are NOT listed: they are their destination's index, rendered by the
 * shared <ShellIndex>. The Platform Admin destination self-gates to superadmins;
 * visibility is decided here — no prop-drilled flags.
 */

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

/** Persisted per stage, separately from the rail's own collapsed state — a
 *  collapsed GROUP inside an expanded rail is a different intention from a
 *  collapsed rail, so neither may infer the other. */
const COLLAPSE_KEY = 'bf-nav-stage-collapsed';

function readCollapsed(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function GroupLink({ group, active, onNavigate, t, badge = 0, locked = false, lockHint }: {
  group: NavGroup;
  active: boolean;
  onNavigate?: () => void;
  t: (k: string) => string;
  badge?: number;
  /** Renders visible and inert instead of navigating — see the note below. */
  locked?: boolean;
  lockHint?: string;
}) {
  const label = t(group.labelKey);
  const body = (
    <>
      <span className="nav-item-icon"><NavIcon name={group.id} /></span>
      <span className="nav-item-label">{label}</span>
      {/* The seat badge, in that seat's own hue from the one declaration
          (§11.10.1). A platform-owned destination has no teammate, so no chip —
          which is exactly PRD 21 §4's test for whether a seat exists at all. */}
      {isSeat(group.seat) && (
        <span className="nav-item__seat" style={{ '--seat': `var(${seatHueVar(group.seat)})` } as React.CSSProperties}>
          {group.seat}
        </span>
      )}
      {locked && <span className="nav-item__lock" aria-hidden="true"><Icon source="🔒" size="1em" /></span>}
      {!!badge && <span aria-label={`${badge} unread sessions`} style={{ marginLeft: 'auto', minWidth: 17, height: 17, borderRadius: 'var(--radius-full)', display: 'grid', placeItems: 'center', background: 'var(--accent)', color: 'var(--text-on-accent)', fontSize: 'var(--font-size-field-label)', fontWeight: 800 }}>{badge > 99 ? '99+' : badge}</span>}
    </>
  );

  // Disable, never hide (PRD 21 §2.6 rule 7). A visitor with no account sees the
  // whole product's shape — what they cannot do yet reads as "not yet", not as
  // "this product does not do that". A `<span>` rather than a dimmed `<Link>`:
  // an anchor that looks disabled is still followable by keyboard and by
  // middle-click, so the state has to be the element, not a class on it.
  if (locked) {
    return (
      <span className="nav-item nav-item--locked flex items-center" aria-disabled="true" title={lockHint} data-label={label} data-tour={group.id}>
        {body}
      </span>
    );
  }

  return (
    <Link
      href={group.href}
      onClick={onNavigate}
      className={`nav-item ${active ? 'active' : ''} flex items-center`}
      style={{ textAlign: 'left' }}
      aria-current={active ? 'page' : undefined}
      data-label={label}
    >
      {body}
    </Link>
  );
}

export default function Sidebar({ collapsed, onToggleCollapsed, mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname() || '';
  const t = useTranslations('nav');
  const ts = useTranslations('sessions');
  const { user, isAuthenticated } = useAuth();

  const allGroups = useNavGroups();
  // Resolved against THIS account's rows, so a sales or freelancer route
  // highlights its own row. It used to ask the builder registry and fall back to
  // a second, hand-rolled prefix match written right here — two matchers for one
  // question, and the local one silently disagreed (no `/settings` exact-match
  // carve-out, so `/settings/api-keys` resolved differently in each).
  const activeGroupId = findActiveGroup(pathname, allGroups)?.id;
  const groups = allGroups.filter((g) => !g.superadminOnly || user?.isSuperadmin);

  // Progressive disclosure through the ONE helper (§11.4.4): a row is always
  // listed, and the rung decides whether it is live. A local canvas is the
  // product rather than a teaser, so its rail stays navigable while signed out.
  const [collapsedStages, setCollapsedStages] = useState<Record<string, boolean>>({});
  useEffect(() => { setCollapsedStages(readCollapsed()); }, []);

  const toggleStage = useCallback((stage: Stage) => {
    setCollapsedStages((prev) => {
      const next = { ...prev, [stage]: !prev[stage] };
      try { window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

  const onStage = isStageRoute(pathname);
  // Whether a row is a door this visitor can walk through — asked of the same
  // routing that renders the page, never of a second ladder that can disagree
  // with it. See `destinationReachable`. `onStage` keeps the whole rail live
  // while a board is open, which is the local-first canvas's own rule.
  const reachable = useCallback(
    (group: NavGroup) => onStage || destinationReachable(group.href, isAuthenticated),
    [isAuthenticated, onStage],
  );


  return (
    <>
      <div className={`nav-backdrop${mobileOpen ? ' open' : ''}`} onClick={onMobileClose} aria-hidden="true" />
      <nav className={`nav ${collapsed ? 'collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
        <button
          type="button"
          className="nav-collapse-toggle"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
          aria-expanded={!collapsed}
          title={collapsed ? t('expandSidebar') : t('collapseSidebar')}
        >
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="nav-collapse-tooltip" role="tooltip">
            {collapsed ? t('expandSidebar') : t('collapseSidebar')}
          </span>
        </button>

        {/* Mobile drawer header (hidden on desktop via CSS) */}
        <div className="nav-mobile-head">
          <span className="nav-mobile-title">{t('menu')}</span>
          <button type="button" className="nav-mobile-close" onClick={onMobileClose} aria-label={t('closeMenu')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        <div className="nav-main">
          {/* The person's own work leads. Collapsed to the icon rail there is no
              room for titles, so the sessions fold away and the destinations
              stay — the rail is a way back to a place, not to a board. */}
          {!collapsed && <SessionList onNavigate={onMobileClose} />}
          <div className="nav-section">
            {STAGES.map((stage) => {
              const rows = groupsForStage(groups, stage);
              if (rows.length === 0) return null;
              // A stage is live when ANY of its rows is. Dim, never absent:
              // "a dim row is an invitation; a missing row is a secret."
              const earned = rows.some(reachable);
              const isOpen = !collapsedStages[stage];
              return (
                <div key={stage} className={`nav-stage${earned ? '' : ' nav-stage--dim'}`} data-stage={stage}>
                  {!collapsed && (
                    <button
                      type="button"
                      className="ui-eyebrow nav-stage__label"
                      onClick={() => toggleStage(stage)}
                      aria-expanded={isOpen}
                      aria-controls={`nav-stage-${stage}`}
                    >
                      <span className="nav-stage__dot" aria-hidden="true" />
                      {t(`stage.${stage}`)}
                      {!earned && <em className="nav-stage__hint">{t('stage.notYet')}</em>}
                      <svg className="nav-stage__chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  )}
                  <div id={`nav-stage-${stage}`} className="nav-stage__rows" hidden={!collapsed && !isOpen}>
                    {rows.map((g) => (
                      <GroupLink
                        key={g.id}
                        group={g}
                        active={activeGroupId === g.id}
                        onNavigate={onMobileClose}
                        t={t}
                        // A local Canvas is the product, not a teaser. Its
                        // destination rail stays navigable while signed out; the
                        // destination's durable Create/Save action owns the
                        // account gate.
                        locked={!reachable(g)}
                        lockHint={t('stage.lockHint')}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* The one thing a signed-out visitor's rail is missing: the way to keep
            what they are making. Their board is real and local-first, so this is
            an offer rather than a wall.
            NOT on a stage route: the canvas already makes the same offer, in the
            same colour the "keep your work" state uses, from the top-right CTA
            (`MarketingHeader`) — a second copy of it down here would be the same
            offer made twice in two different visual languages on one screen. */}
        {!collapsed && !isAuthenticated && !onStage && (
          <div className="nav-footer">
            <ButtonLink href={signInHref(pathname)} variant="primary" size="sm" block>
              {ts('signInToKeep')}
            </ButtonLink>
          </div>
        )}

        {/* Usage/consumption meters — the left menu's own "USAGE" section
            (per hired.video), sitting above the legal menu rather than
            floating over the board. Collapsed to the icon rail there is no
            room for it, same rule as the session list and legal strip. */}
        {!collapsed && <UsageMeter />}

        {/* Copyright + version + Terms/Privacy, always in the rail rather than
            floating a full-width strip under the whole frame or riding the
            docked Brain panel's footer — the far-left menu is where an operator
            already looks for the shell's own chrome, and keeping it here means
            it never competes with the board for the frame's bottom edge, on a
            stage route or otherwise. Collapsed to the icon rail there is no
            room for it, same rule as the session list above. */}
        {!collapsed && <LegalStrip className="nav-legal" />}
      </nav>
    </>
  );
}
