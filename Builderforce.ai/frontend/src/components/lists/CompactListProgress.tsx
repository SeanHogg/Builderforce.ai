'use client';

import type { CSSProperties } from 'react';

/** ProgressItem: Input shape for QList.Table -> CenPol stretch. */
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

/** Format percent for FR-2 "7/10 or 70%". */
export function formatPct(completed: number, total: number): string {
  return toPercent(completed, total).toFixed(0) + '%';
}

/** Format the numeric value column per the chosen ValueFormat (FR-1/FR-2). */
export function formatValue(
  completed: number,
  total: number,
  valueFormat: ValueFormat = 'fraction'
): string {
  if (valueFormat === 'percent') return formatPct(completed, total);
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
/** CompactListProgress — A vertical list of items with label, slim progress bar, numeric or percentage value, and status badge.

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
  let displayItems: ProgressItem[] = items ?? [];

  // FR-5: sortBy logic
  if (sortBy === 'progress_desc' && items?.length) {
    displayItems = [...displayItems].sort((a, b) => {
      const pctA = (a.completed / Math.max(1, a.total)) * 100;
      const pctB = (b.completed / Math.max(1, b.total)) * 100;
      return pctB - pctA;
    });
  } else if (sortBy === 'progress_asc' && items?.length) {
    displayItems = [...displayItems].sort((a, b) => {
      const pctA = (a.completed / Math.max(1, a.total)) * 100;
      const pctB = (b.completed / Math.max(1, b.total)) * 100;
      return pctA - pctB;
    });
  } else if (sortBy === 'status' && items?.length) {
    const order: Record<string, number> = {
      not_started: 0,
      in_progress: 1,
      completed: 2,
      blocked: 3,
    };
    displayItems = [...displayItems].sort((a, b) => order[a.status] - order[b.status]);
  } else if (sortBy === 'label_asc' && items?.length) {
    displayItems = [...displayItems].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { numeric: true })
    );
  }

  // FR-6: loading state
  if (isLoading) {
    return (
      <div
        role="list"
        aria-busy="true"
        className={className}
        aria-label={ariaLabel ?? ''}
      >
        {Array.from({ length: skeletonRowCount }, (_, i) => (
          <div key={i} role="listitem" style={skeletonRow}>
            <span style={skeletonLabel} aria-hidden>
              ————————
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
      <span role="status" className={className} aria-label={ariaLabel ?? ''}>
        {emptyText ?? 'No items to display'}
      </span>
    );
  }

  return (
    <div role="list" className={className} aria-label={ariaLabel ?? ''}>
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
              <span style={progressBg} aria-hidden />
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

/* ── StatusBadge helper (FR-4/FR-7/FR-8) ──────────────────────────────────── */
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

/* ── Styles (FR-3) ───────────────────────────────────────────────────────── */
const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  height: ROW_MAX_HEIGHT,
  width: '100%',
};

const label: CSSProperties = {
  fontSize: '0.84rem',
  fontWeight: 600,
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: '120px',
  maxWidth: '300px',
  display: 'inline-block',
  flex: '0 0 auto',
  cursor: 'default',
};

const progressContainer: CSSProperties = {
  position: 'relative',
  height: BAR_HEIGHT,
  flex: 1,
  minWidth: '60px',
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
  opacity: 0.3,
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

const percent: CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  width: '50px',
  textAlign: 'right',
  flex: '0 0 auto',
  minWidth: '60px',
};

const emptyState: CSSProperties = {
  fontSize: '0.9rem',
  color: 'var(--text-muted)',
  textAlign: 'center',
  padding: '24px 0',
  fontStyle: 'italic',
};

/* ── Skeleton styles (FR-6) ───────────────────────────────────────────────── */
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
  minWidth: '120px',
  maxWidth: '300px',
  flex: '0 0 auto',
};

const skeletonBar: CSSProperties = {
  flex: '1 1 auto',
  height: BAR_HEIGHT,
  minWidth: '80px',
  borderRadius: '999px',
  background: 'var(--surface-muted, rgba(148, 163, 184, 0.25))',
};

const skeletonPerc: CSSProperties = {
  color: 'transparent',
  background: 'var(--surface-muted, rgba(148, 163, 184, 0.25))',
  borderRadius: '4px',
  fontSize: '0.72rem',
  fontWeight: 500,
  width: '50px',
  textAlign: 'right',
  flex: '0 0 auto',
  minWidth: '60px',
};