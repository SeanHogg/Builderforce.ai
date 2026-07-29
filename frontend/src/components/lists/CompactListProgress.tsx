'use client';

import type { CSSProperties } from 'react';

/**
 * CompactListProgress — a domain-agnostic, read-only progress breakdown rendered as a
 * dense vertical list (PRD.md "Compact List Progress Breakdown", task #667).
 *
 * One row per item: label (truncating), a slim progress bar, a numeric value column
 * (`5/10` or `50%`), and a status badge that carries an icon + text so meaning is never
 * conveyed by colour alone. Covers FR-1..FR-8.
 *
 * It holds no state, performs no fetching and never mutates its input, so any list view
 * can drop it in against its existing data layer by mapping to {@link ProgressItem}.
 */

/** One row of the breakdown. The only shape a caller must map to (FR-2/FR-8). */
export type ProgressItem = {
  id: string;
  label: string;
  completed: number;
  total: number;
  status: 'not_started' | 'in_progress' | 'completed' | 'blocked';
};

/** Item with persisted order (default input order). */
export type PList = ProgressItem[];

/** SortBy options (FR-5). */
export type SortBy = 'progress_desc' | 'progress_asc' | 'status' | 'label_asc';

/** How the numeric value column renders (FR-1/FR-2: "7/10 or 70%"). */
export type ValueFormat = 'fraction' | 'percent';

/** Compute a progress percentage clamped to [0, 100], handling total=0 safely (FR-2). */
export function toPercent(completed: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const pct = (completed / total) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** Format a percentage for the value column, e.g. `70%` (FR-1/FR-2). */
export function formatPct(completed: number, total: number): string {
  return Math.round(toPercent(completed, total)) + '%';
}

/**
 * Format the numeric value column per the chosen ValueFormat (FR-1/FR-2).
 *
 * With no denominator to divide by (`total <= 0`) a fraction like `5/0` would be
 * meaningless, so the value degrades to `0%` — satisfying AC-3's "renders 0% (or N/A)
 * without throwing".
 */
export function formatValue(
  completed: number,
  total: number,
  valueFormat: ValueFormat = 'fraction'
): string {
  if (valueFormat === 'percent') return formatPct(completed, total);
  if (!Number.isFinite(total) || total <= 0) return formatPct(completed, total);
  return `${completed}/${total}`;
}

/** All valid status values (FR-2). */
export const STATUS_VALUES: ProgressItem['status'][] = [
  'not_started',
  'in_progress',
  'completed',
  'blocked',
];

/** Human-readable status labels — used for text badges + ARIA (FR-7, not colour-alone). */
export const STATUS_LABELS: Record<ProgressItem['status'], string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  blocked: 'Blocked',
};

/** Small non-colour glyph per status so meaning is conveyed beyond colour (FR-7). */
export const STATUS_ICONS: Record<ProgressItem['status'], string> = {
  not_started: '○',
  in_progress: '◐',
  completed: '✓',
  blocked: '⚠',
};

/** Rank used by `sortBy="status"`, following the lifecycle order in FR-4. */
const STATUS_ORDER: Record<ProgressItem['status'], number> = {
  not_started: 0,
  in_progress: 1,
  completed: 2,
  blocked: 3,
};

/**
 * Apply {@link SortBy} without mutating the caller's array (FR-5). Undefined `sortBy`
 * preserves the data source's order. `Array.prototype.sort` is stable per spec, so ties
 * keep their incoming relative order.
 */
export function sortItems(items: readonly ProgressItem[], sortBy?: SortBy): ProgressItem[] {
  const next = [...items];
  switch (sortBy) {
    case 'progress_desc':
      return next.sort((a, b) => toPercent(b.completed, b.total) - toPercent(a.completed, a.total));
    case 'progress_asc':
      return next.sort((a, b) => toPercent(a.completed, a.total) - toPercent(b.completed, b.total));
    case 'status':
      return next.sort((a, b) => (STATUS_ORDER[a.status] ?? 0) - (STATUS_ORDER[b.status] ?? 0));
    case 'label_asc':
      return next.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    default:
      return next;
  }
}

/** Design-token colour per status (FR-4). Unknown values fall back to the neutral token. */
export function getColorByStatus(status: string): CSSProperties['color'] {
  switch (status) {
    case 'completed':
      return 'var(--success)';
    case 'in_progress':
      return 'var(--accent)';
    case 'blocked':
      return 'var(--error)';
    case 'not_started':
    default:
      return 'var(--muted)';
  }
}

/** VisualDensity constants (FR-3). */
const ROW_MAX_HEIGHT: CSSProperties['height'] = 40;
const BAR_HEIGHT: CSSProperties['height'] = 6;

/* ── CompactListProgress ─────────────────────────────────────────────────── */
/**
 * CompactListProgress — A vertical list of items with label, slim progress bar, numeric or percentage value, and status badge.

   FR-1, FR-2, FR-3, FR-4, FR-7, FR-8.

   <CompactListProgress
     items={items}
     sortBy="progress_desc"
     isLoading={false}
   />
*/
export function CompactListProgress({
  items,
  sortBy,
  isLoading,
  emptyText,
  showValue = true,
  valueFormat = 'fraction',
  skeletonRowCount = 3,
  className,
  'aria-label': ariaLabel,
}: {
  items?: PList;
  sortBy?: SortBy;
  isLoading?: boolean;
  emptyText?: string;
  /** Show the numeric value column (fraction or percent). Defaults to true. */
  showValue?: boolean;
  /** Whether the value column renders as `7/10` (fraction) or `70%` (percent). */
  valueFormat?: ValueFormat;
  /** Number of skeleton rows to render while loading (FR-6). */
  skeletonRowCount?: number;
  /** Optional class applied to the list container so parents can scope layout. */
  className?: string;
  /** Accessible name for the whole list (FR-7). */
  'aria-label'?: string;
}) {
  // FR-5: order is the data source's unless an explicit sortBy is given.
  const displayItems = sortItems(items ?? [], sortBy);

  // FR-6: loading state
  if (isLoading) {
    return (
      <div
        role="list"
        aria-busy="true"
        className={className}
        style={listContainer}
        aria-label={ariaLabel}
      >
        {Array.from({ length: skeletonRowCount }, (_, i) => (
          <div key={i} role="listitem" style={skeletonRow}>
            <span style={skeletonLabel} aria-hidden>
              ———————————
            </span>
            <span style={skeletonBar} aria-hidden />
            <span style={skeletonValue} aria-hidden>
              —
            </span>
          </div>
        ))}
      </div>
    );
  }

  // FR-6: empty state
  if (!displayItems.length) {
    return (
      <span role="status" className={className} style={emptyState} aria-label={ariaLabel}>
        {emptyText ?? 'No items to display'}
      </span>
    );
  }

  return (
    <div role="list" className={className} style={listContainer} aria-label={ariaLabel}>
      {displayItems.map((item) => {
        const pct = toPercent(item.completed, item.total);
        const pctStr = Math.round(pct) + '%';
        const valueStr = formatValue(item.completed, item.total, valueFormat);

        return (
          <div key={item.id} role="listitem" style={row} tabIndex={0}>
            <span
              style={label}
              title={item.label} // ensure truncated text has a tooltip (FR-3)
            >
              {item.label}
            </span>
            <span style={progressContainer}>
              <>
                {/* FR-3: track background */}
                <span style={progressBg} aria-hidden />
                {/* Progress bar foreground */}
                <span
                  style={{
                    ...progressFg,
                    width: `${pct}%`,
                    backgroundColor: getColorByStatus(item.status),
                  }}
                  role="progressbar"
                  aria-valuenow={Math.round(pct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${item.label} (${STATUS_LABELS[item.status]}) progress: ${pctStr}`}
                />
              </>
            </span>
            {showValue && (
              <span style={value} aria-hidden>
                {valueStr}
              </span>
            )}
            <StatusBadge status={item.status} />
          </div>
        );
      })}
    </div>
  );
}

/* ─── StatusBadge helper (FR-4/FR-7/FR-8) ──────────────────────────────────── */
/**
 * StatusBadge — a pill carrying both an icon glyph AND a text label (never colour
 * alone), plus a descriptive `aria-label`, satisfying FR-7.
 */
function StatusBadge({ status }: { status: ProgressItem['status'] }) {
  const text = STATUS_LABELS[status] ?? status;
  const icon = STATUS_ICONS[status] ?? '•';
  const badgeStyle: CSSProperties = {
    ...badgeBase,
    backgroundColor: getColorByStatus(status),
  };
  return (
    <span style={badgeStyle} aria-label={`Status: ${text}`}>
      <span aria-hidden style={badgeIcon}>
        {icon}
      </span>
      {text}
    </span>
  );
}

/* ─── Styles (FR-3) ───────────────────────────────────────────────────────── */
/**
 * FR-3: the list owns its width and clips its children, so a long label can never
 * introduce a horizontal scrollbar in the container at any viewport width (AC-10).
 */
const listContainer: CSSProperties = {
  width: '100%',
  maxWidth: '100%',
  boxSizing: 'border-box',
  overflowX: 'hidden',
};

const emptyState: CSSProperties = {
  display: 'block',
  padding: '12px 0',
  fontSize: '0.8rem',
  color: 'var(--text-secondary)',
};

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  height: ROW_MAX_HEIGHT,
  maxHeight: ROW_MAX_HEIGHT, // FR-3: rows never exceed 40px
  width: '100%',
  boxSizing: 'border-box',
  overflow: 'hidden', // FR-3: no horizontal scroll leaks out of a row
};

const label: CSSProperties = {
  fontSize: '0.84rem',
  fontWeight: 600,
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  // Flexible + shrinkable so the label truncates (never overflows) even at 320px (FR-3/AC-5/AC-10).
  flex: '1 1 40%',
  minWidth: 0,
  cursor: 'default',
};

const progressContainer: CSSProperties = {
  position: 'relative',
  height: BAR_HEIGHT,
  maxHeight: BAR_HEIGHT, // FR-3: bar height never exceeds 6px
  flex: '1 1 auto',
  minWidth: '48px',
  overflow: 'hidden',
  display: 'flex',
};

const progressBg: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  bottom: 0,
  borderRadius: '999px',
  backgroundColor: 'var(--border-subtle)',
  zIndex: 0,
};

const progressFg: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  height: '100%',
  borderRadius: '999px',
  zIndex: 1,
  transition: 'width 200ms linear',
};

const value: CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  minWidth: '44px',
  textAlign: 'right',
  flex: '0 0 auto',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

const badgeBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '2px 10px',
  borderRadius: '999px',
  fontSize: '0.68rem',
  fontWeight: 700,
  lineHeight: 1.2,
  color: '#fff',
  whiteSpace: 'nowrap',
  flex: '0 0 auto',
};

const badgeIcon: CSSProperties = {
  fontSize: '0.72rem',
  lineHeight: 1,
};

/* ─── Skeleton styles (FR-6) ───────────────────────────────────────────────── */
const skeletonRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  height: ROW_MAX_HEIGHT,
  width: '100%',
  opacity: 0.5,
};

const skeletonLabel: CSSProperties = {
  fontSize: '0.84rem',
  fontWeight: 600,
  color: 'transparent',
  background: 'var(--surface-muted, rgba(148, 163, 184, 0.25))',
  borderRadius: '4px',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  flex: '1 1 40%',
  minWidth: 0,
  maxWidth: 300,
};

const skeletonBar: CSSProperties = {
  flex: '1 1 auto',
  height: BAR_HEIGHT,
  minWidth: '64px',
  borderRadius: '999px',
  opacity: 0.5,
  background: 'var(--surface-muted, rgba(148, 163, 184, 0.25))',
};

const skeletonValue: CSSProperties = {
  color: 'transparent',
  background: 'var(--surface-muted, rgba(148, 163, 184, 0.25))',
  borderRadius: '4px',
  fontSize: '0.72rem',
  fontWeight: 500,
  width: '44px',
  textAlign: 'right',
  flex: '0 0 auto',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};