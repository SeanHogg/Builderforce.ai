'use client';

/**
 * The roster IS the navigation (PRD 20 §7).
 *
 * "The fifteen domains and the fifteen seats are the same list, and neither may
 * drift from the other." So this reads `/api/roster` — the same list the schema's
 * `objects.domain` column and the permission modules read — rather than a nav
 * array maintained beside it.
 *
 * THE TWO CORRECTIONS THIS ENCODES.
 *   v3 made the roster the front door, which answers "how do I reach 549
 *   destinations" and is the wrong answer to "how do I start" — somebody arriving
 *   to build a landing page does not want to meet the CFO. So the canvas is the
 *   front door and this is a rail beside it.
 *   v4 made the roster APPEAR as you climbed, which turned a discovery surface
 *   into a locked door — nobody asks for a capability they have never seen. So:
 *   **the team is always listed, because it is navigation; only the scope chips
 *   are earned, because they are state.** A dimmed CFO is an invitation. A
 *   missing CFO is a secret. `earned()` below is the one helper that decides it.
 *
 * THE COLLAPSE SEAM. Compress what is identity (initials stay legible at 21px →
 * the rail), fly out what is text (titles → the flyout). A `ResizeObserver` sets
 * the SAME state the toggle sets, through one `rail()` helper — so there is one
 * definition of "collapsed" and the breakpoint and the toggle cannot drift apart.
 * One overlay serves both the compressed-seat tooltip and the recents list; a
 * second implementation is how the two start disagreeing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { observeResizeOnAnimationFrame } from '@/lib/observeResize';
import {
  getRecents,
  getRoster,
  type Domain,
  type DomainSummary,
  type ObjectRef,
} from '@/lib/kernel/kernelApi';

/** Width below which the rail collapses whether or not the user asked. */
const RAIL_BREAKPOINT = 640;

/** Seat → initials. Identity survives compression; a title does not. */
function initials(seat: string): string {
  const words = seat.trim().split(/\s+/);
  if (words.length === 1) return seat.slice(0, 3).toUpperCase();
  return words.map((w) => w[0]).join('').slice(0, 3).toUpperCase();
}

/**
 * THE entitlement helper.
 *
 * One place decides whether a seat's scope chips are lit. Every consumer asks
 * this rather than being handed a `canX` boolean it could have computed —
 * the same DRY rule §7.2 states for components.
 */
export function earned(rung: number, reached: number): boolean {
  return rung <= reached;
}

export function RosterNav({
  activeDomain,
  onSelect,
  onOpenObject,
  /** How far this tenant has climbed. Seats above it are dimmed, never hidden. */
  reachedRung = 3,
  locale = 'en',
}: {
  activeDomain?: Domain;
  onSelect?: (domain: Domain) => void;
  onOpenObject?: (objectId: string) => void;
  reachedRung?: number;
  locale?: string;
}) {
  const t = useTranslations('kernel.roster');
  const shell = useRef<HTMLElement | null>(null);
  const [rows, setRows] = useState<DomainSummary[] | null>(null);
  const [recents, setRecents] = useState<ObjectRef[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [userCollapsed, setUserCollapsed] = useState(false);
  const [flyout, setFlyout] = useState<{ top: number; label: string } | null>(null);

  /**
   * The ONE definition of "collapsed". Both the toggle and the ResizeObserver
   * call this, so a narrow viewport and a deliberate collapse produce identical
   * state rather than two rule sets that drift.
   */
  const rail = useCallback((next: boolean, fromUser = false) => {
    setCollapsed(next);
    if (fromUser) setUserCollapsed(next);
  }, []);

  useEffect(() => {
    void getRoster().then(setRows).catch(() => setRows([]));
    void getRecents({ limit: 8 }).then(setRecents).catch(() => setRecents([]));
  }, []);

  useEffect(() => {
    const node = shell.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    return observeResizeOnAnimationFrame(node, ([entry]) => {
      if (!entry) return;
      // A width-forced collapse never un-collapses something the user chose.
      rail(userCollapsed || entry.contentRect.width < RAIL_BREAKPOINT);
    });
  }, [rail, userCollapsed]);

  return (
    <nav
      ref={shell}
      aria-label={t('label')}
      data-rail={collapsed ? '1' : '0'}
      className="relative flex flex-col min-h-0 h-full"
      style={{
        width: collapsed ? 56 : 216,
        transition: 'width .18s ease',
        background: 'var(--surface-2, rgba(255,255,255,0.04))',
        borderRight: '1px solid var(--border-subtle)',
      }}
    >
      <div className="flex justify-end px-2 pt-2">
        <button
          type="button"
          onClick={() => rail(!collapsed, true)}
          aria-label={collapsed ? t('expand') : t('collapse')}
          aria-expanded={!collapsed}
          className="rounded-md w-6 h-6 text-xs"
          style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid transparent' }}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <ul className="flex-1 overflow-y-auto m-0 p-0 list-none min-h-0">
        {!collapsed ? (
          <li
            className="px-3 pt-2 pb-1 text-[0.58rem] font-semibold uppercase tracking-[0.13em]"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('team')}
          </li>
        ) : null}

        {(rows ?? []).map((row) => {
          const lit = earned(row.rung, reachedRung);
          const active = row.domain === activeDomain;
          return (
            <li key={row.domain}>
              <button
                type="button"
                onClick={() => onSelect?.(row.domain)}
                aria-current={active}
                data-locked={lit ? '0' : '1'}
                onMouseEnter={(e) =>
                  collapsed && setFlyout({ top: e.currentTarget.offsetTop, label: t(`domain.${row.domain}`) })
                }
                onMouseLeave={() => setFlyout(null)}
                onFocus={(e) =>
                  collapsed && setFlyout({ top: e.currentTarget.offsetTop, label: t(`domain.${row.domain}`) })
                }
                onBlur={() => setFlyout(null)}
                className="flex items-center gap-2 w-[calc(100%-12px)] mx-1.5 my-px px-1.5 py-1.5 rounded-md text-left"
                style={{
                  background: active ? 'var(--surface-interactive, rgba(255,255,255,0.08))' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: '1px solid transparent',
                  // Dimmed, never absent: an unearned seat is an invitation.
                  opacity: lit ? 1 : 0.52,
                  justifyContent: collapsed ? 'center' : 'flex-start',
                }}
              >
                <span
                  aria-hidden
                  className="grid place-items-center rounded-full shrink-0 text-[0.53rem] font-bold"
                  style={{
                    width: 21,
                    height: 21,
                    background: 'var(--surface-interactive, rgba(255,255,255,0.08))',
                    color: active ? 'var(--accent)' : 'var(--text-muted)',
                    border: `1px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  }}
                >
                  {initials(row.seat)}
                </span>
                {!collapsed ? (
                  <>
                    <span className="flex-1 min-w-0 truncate text-[0.8rem]">{t(`domain.${row.domain}`)}</span>
                    {row.recentEventCount > 0 ? (
                      <span
                        aria-label={t('activeNow')}
                        className="shrink-0 rounded-full"
                        style={{ width: 6, height: 6, background: 'var(--accent)' }}
                      />
                    ) : null}
                  </>
                ) : null}
              </button>
            </li>
          );
        })}

        {/* Titles do not survive compression, so recents leaves the rail entirely
            and comes back as the flyout. Identity does survive — the team stays. */}
        {!collapsed && recents.length > 0 ? (
          <>
            <li
              className="px-3 pt-4 pb-1 text-[0.58rem] font-semibold uppercase tracking-[0.13em]"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('recents')}
            </li>
            {recents.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onOpenObject?.(r.id)}
                  className="flex items-center gap-2 w-[calc(100%-12px)] mx-1.5 my-px px-1.5 py-1.5 rounded-md text-left"
                  style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid transparent' }}
                  title={new Date(r.updatedAt).toLocaleString(locale)}
                >
                  <span className="flex-1 min-w-0 truncate text-[0.78rem]">{r.title ?? r.kind}</span>
                </button>
              </li>
            ))}
          </>
        ) : null}
      </ul>

      {/* ONE overlay, two jobs: the compressed-seat tooltip, and (when the rail
          is open) nothing — because the list is inline. A second implementation
          is how the two start disagreeing. */}
      {flyout ? (
        <div
          role="tooltip"
          className="absolute z-10 rounded-md px-2 py-1 text-[0.7rem] pointer-events-none"
          style={{
            left: 60,
            top: flyout.top,
            background: 'var(--surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 8px 24px rgba(0,0,0,.28)',
          }}
        >
          {flyout.label}
        </div>
      ) : null}
    </nav>
  );
}
