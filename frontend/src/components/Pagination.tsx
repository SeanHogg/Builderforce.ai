/**
 * No `'use client'` here on purpose. Every importer — the blog index, the prompt
 * library, the marketplace — already declares the boundary, and a module
 * imported by a client module is client code either way. See the note at the
 * top of `scripts/check-frontend-architecture.mjs`: the directive answers no
 * question the import graph has not already answered.
 *
 * Pagination — the canonical pager for every paged collection.
 *
 * Three surfaces had grown their own: the blog index rendered a numbered strip
 * of `.blog-page-btn`s, the marketplace's Talent tab a bare `←  page x of y  →`
 * pair, and the session list a third variant with its own inline styles. Same
 * control, three sets of markup, three sets of English-only labels — and only
 * one of them was reachable by keyboard users as anything other than an arrow
 * glyph with no accessible name.
 *
 * One component, two densities:
 *
 *   <Pagination page={p} pageCount={n} onChange={setP} />                // numbered
 *   <Pagination page={p} pageCount={n} onChange={setP} compact />        // ← x of y →
 *
 * Pages are 1-BASED throughout — the number a person reads is the number the
 * component is given, so no call site has to remember an off-by-one. It renders
 * nothing at all for a single page, so a caller never needs to guard it.
 */

import { useTranslations } from 'next-intl';

export interface PaginationProps {
  /** Current page, 1-based. */
  page: number;
  /** Total number of pages. */
  pageCount: number;
  onChange: (page: number) => void;
  /** `← page x of y →` instead of the numbered strip. */
  compact?: boolean;
  /** Overrides the default "Pagination" group label for screen readers. */
  ariaLabel?: string;
  className?: string;
}

/**
 * The page numbers to render, with `null` standing for a gap.
 *
 * The blog's strip printed EVERY page — fine at three, a wrapping wall of
 * buttons at fifteen. First, last, and a window around the current page, so the
 * control keeps its size as the corpus grows.
 */
export function pageWindow(page: number, pageCount: number, radius = 1): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const keep = new Set([1, pageCount]);
  for (let p = page - radius; p <= page + radius; p += 1) {
    if (p >= 1 && p <= pageCount) keep.add(p);
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) out.push(null);
    out.push(p);
    previous = p;
  }
  return out;
}

const btn: React.CSSProperties = {
  minWidth: 38,
  height: 38,
  padding: '0 12px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  cursor: 'pointer',
};

const activeBtn: React.CSSProperties = {
  ...btn,
  background: 'var(--coral-bright)',
  borderColor: 'transparent',
  color: 'var(--text-on-accent)',
};

const disabledBtn: React.CSSProperties = { ...btn, opacity: 0.4, cursor: 'not-allowed' };

export function Pagination({ page, pageCount, onChange, compact, ariaLabel, className }: PaginationProps) {
  const t = useTranslations('common.pagination');
  // Nothing to page through — the control is its own guard, so no call site
  // repeats `{pageCount > 1 && …}`.
  if (pageCount <= 1) return null;

  const current = Math.min(Math.max(page, 1), pageCount);
  const go = (next: number) => onChange(Math.min(Math.max(next, 1), pageCount));

  return (
    <nav
      className={className}
      aria-label={ariaLabel ?? t('label')}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        flexWrap: 'wrap',
        marginTop: 28,
      }}
    >
      <button
        type="button"
        style={current === 1 ? disabledBtn : btn}
        onClick={() => go(current - 1)}
        disabled={current === 1}
        aria-label={t('prev')}
      >
        ←
      </button>

      {compact ? (
        <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
          {t('pageOf', { page: current, pages: pageCount })}
        </span>
      ) : (
        pageWindow(current, pageCount).map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} aria-hidden="true" style={{ color: 'var(--text-muted)', padding: '0 2px' }}>…</span>
          ) : (
            <button
              key={p}
              type="button"
              style={p === current ? activeBtn : btn}
              onClick={() => go(p)}
              aria-current={p === current ? 'page' : undefined}
              aria-label={t('pageN', { n: p })}
            >
              {p}
            </button>
          ),
        )
      )}

      <button
        type="button"
        style={current === pageCount ? disabledBtn : btn}
        onClick={() => go(current + 1)}
        disabled={current === pageCount}
        aria-label={t('next')}
      >
        →
      </button>
    </nav>
  );
}

export default Pagination;
