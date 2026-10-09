// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useFormat } from '@/i18n/useFormat';

export interface StudioCard {
  key: string;
  href: string;
  title: string;
  /** ISO time it last changed, or null. */
  updatedAt: string | null;
}

/** How many cards a list shows. */
const SHOWN = 12;

/** Newest first, the first {@link SHOWN} — the order and the cap every Studio list uses. */
export function newestStudioCards(cards: readonly StudioCard[]): StudioCard[] {
  return [...cards].sort((a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? '')).slice(0, SHOWN);
}

/**
 * A titled grid of things to open on the Studio home — the apps started here and the
 * durable Studio projects read as the same kind of card, so the two lists cannot drift
 * apart in markup or spacing. Presentational: the caller owns the data and decides
 * whether there is a list at all (an empty list renders nothing). The list owns its order
 * and its length ({@link newestStudioCards}), so a caller hands over cards unsorted.
 */
export function StudioCardList({ id, title, cards, action }: { id: string; title: string; cards: readonly StudioCard[]; action?: ReactNode }) {
  const fmt = useFormat();
  if (cards.length === 0) return null;
  const shown = newestStudioCards(cards);
  return (
    <section aria-labelledby={id} style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 id={id} className="ui-text-card-title" style={{ margin: 0 }}>{title}</h2>
        {action}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))' }}>
        {shown.map((card) => (
          <li key={card.key}>
            <Link
              href={card.href}
              style={{ display: 'grid', gap: 4, padding: 14, minHeight: 72, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', textDecoration: 'none' }}
            >
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.title}</span>
              {card.updatedAt && <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{fmt.dateTime(card.updatedAt)}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
