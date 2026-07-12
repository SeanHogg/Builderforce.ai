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

/** Format percent for FR-2 "7/10 or 70%". */
export function formatPct(completed: number, total: number): string {
  if (total <= 0) return '0%';
  const pct = (completed / total) * 100;
  return Math.max(0, Math.min(100, pct)).toFixed(0) + '%';
}

/** Get color token by status (FR-4). */
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
  showPercentage = true,
}: {
  items?: PList;
  sortBy?: SortBy;
  isLoading?: boolean;
  emptyText?: string;
  showPercentage?: boolean;
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
      <div role="list" aria-busy="true">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} role="listitem" style={skeletonRow}>
            <span style={skeletonLabel} aria-hidden>
              ——
            </span>
            <span style={skeletonPerc} aria-hidden>
              {(i - 1) / 2 * 100}%
            </span>
          </div>
        ))}
      </div>
    );
  }

  // FR-6: empty state
  if (!displayItems.length) {
    return (
      <span role="status" style={emptyState}>
        {emptyText ?? 'No items to display'}
      </span>
    );
  }

  return (
    <div role="list">
      {displayItems.map((item) => {
        const pct = (item.completed / Math.max(1, item.total)) * 100;
        const pctStr = pct.toFixed(0) + '%';

        return (
          <div
            key={item.id}
            role="listitem"
            style={row}
            tabIndex={0}
            onKeyDown={(e) => {
              // FR-8: no click behavior (Out of Scope)
              if (e.key === 'Enter') {
                // Placeholder for future navigation hook (acquire useNavigate from app router)
                // e.preventDefault();
              }
            }}
          >
            <span
              style={label}
              aria-label={`${item.label} (${item.status})`}
              title={item.label} // ensure truncated text has tooltip
            >
              {item.label}
            </span>
            <span style={progressContainer}>
              <span style={progressBg} />
              <span
                style={{
                  ...progressFg,
                  width: `${pct}%`,
                  backgroundColor: getColorByStatus(item.status),
                }}
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${item.label} (${item.status}) progress: ${pctStr}`}
              />
            </span>
            {showPercentage && (
              <span style={percent}>{item.completed}/{item.total}</span>
            )}
            <span aria-label={`Status: ${item.status}`}>
              <StatusBadge status={item.status} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Export public API ───────────────────────────────────────────────────── */
export { getStatusColor, formatPct, getColorByStatus };
export type { ProgressItem, PList, SortBy };

/* ── StatusBadge helper (FR-4/FR-8) ───────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const base: CSSProperties = {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: '999px',
    fontSize: '0.68rem',
    fontWeight: 700,
    color: '#fff',
    whiteSpace: 'nowrap',
    flex: '0 0 auto',
  };
  let wrapStyle: CSSProperties = { ...base };
  switch (status) {
    case 'completed':
      wrapStyle = { ...wrapStyle, backgroundColor: 'var(--success)' };
      break;
    case 'in_progress':
      wrapStyle = { ...wrapStyle, backgroundColor: 'var(--accent)' };
      break;
    case 'blocked':
      wrapStyle = { ...wrapStyle, backgroundColor: 'var(--error)' };
      break;
    case 'not_started':
    default:
      wrapStyle = { ...wrapStyle, backgroundColor: 'var(--muted)' };
      break;
  }
  return <span style={wrapStyle} aria-label={`Status: ${status}`}>
    {status.replace(/_/g, ' ')}
  </span>;
}

/* ── Invariants mapping (removed previous getColorByStatus) ───────────────── */
function getStatusColor(status: string): CSSProperties['color'] {
  return getColorByStatus(status);
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
  color: 'var(--text-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: '120px',
  maxWidth: '300px',
  flex: '0 0 auto',
};

const skeletonPerc: CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 500,
  color: 'var(--text-muted)',
  width: '50px',
  textAlign: 'right',
  flex: '0 0 auto',
  minWidth: '60px',
};