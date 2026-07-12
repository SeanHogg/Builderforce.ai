'use client';

import type { CSSProperties } from 'react';

// ProgressItem: Input shape derived from QList.Table -> CenPol stretch.
export type ProgressItem = {
  id: string;
  label: string;
  completed: number;
  total: number;
  status: 'not_started' | 'in_progress' | 'completed' | 'blocked';
};

// Item with persisted order (default input order).
export type PList = ProgressItem[];

// SortBy options (FR-5).
export type SortBy = 'progress_desc' | 'progress_asc' | 'status' | 'label_asc';

// VisualDensity: manual clamps (FR-3).
const ROW_MAX_HEIGHT_CLIENT = 40; // px per row; client check stays 40px
const BAR_HEIGHT_CLIENT = 6; // px
const BAR_HEIGHT_COMPONENT_MIN = 4; // px
const LABEL_TRUNCATE_MIN_WIDTH = 60; // px

// Bootstrap color tokens (globals.css).
const COLOR_NEUTRAL = 'var(--muted)';
const COLOR_PRIMARY = 'var(--accent)'; // Coral
const COLOR_SUCCESS = 'var(--success)';
const COLOR_DANGER = 'var(--error)';

/**
 * ProgressListProgress - A vertical list of items, each with label, slim progress bar,
 * numeric or percentage value, and a status badge.
 *
   FR-1, FR-2, FR-3, FR-4, FR-7.
 *
   <CompactListProgress
     items={items}
     sortBy="progress_desc"
     isLoading={false}
   />
*/
export function CompactListProgress({
  items: inputItems,
  sortBy,
  isLoading,
  emptyText,
}: {
  items?: PList;
  sortBy?: SortBy;
  isLoading?: boolean;
  emptyText?: string;
}) {
  let displayItems = (inputItems ?? []).map(item => ({ ...item, __order: Math.random() }));
  if (!isLoading && inputItems?.length && sortBy === 'progress_desc') {
    displayItems.sort((a, b) => {
      const pctA = calculatePct(a.completed, a.total);
      const pctB = calculatePct(b.completed, b.total);
      return pctB - pctA;
    });
  }
  if (!isLoading && inputItems?.length && sortBy === 'progress_asc') {
    displayItems.sort((a, b) => {
      const pctA = calculatePct(a.completed, a.total);
      const pctB = calculatePct(b.completed, b.total);
      return pctA - pctB;
    });
  }
  if (!isLoading && inputItems?.length && sortBy === 'status') {
    const order: Record<string, number> = { not_started: 0, in_progress: 1, completed: 2, blocked: 3 };
    displayItems.sort((a, b) => order[a.status] - order[b.status]);
  }
  if (!isLoading && inputItems?.length && sortBy === 'label_asc') {
    displayItems.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }

  if (isLoading) {
    return (
      <div role="list" aria-busy="true">
        {[1, 2, 3].map(i => (
          <span key={i} style={ROW_CONTAINER}>
            <span style={[LABEL, { width: '100px', overflow: 'hidden' }]} aria-hidden>
              ¬—
            </span>
            <span style={[PERC, { width: `${40 + i * 5}%` }]} aria-hidden />
            <span aria-hidden>{(i - 1) / 3 * 100}%</span>
          </span>
        ))}
      </div>
    );
  }

  if (!displayItems?.length) {
    return (
      <span style={EMPTY_STATE} role="status">
        {emptyText ?? 'No items to display'}
      </span>
    );
  }

  return (
    <div role="list">
      {displayItems.map((item) => (
        <div
          key={item.id}
          role="listitem"
          style={ROW_CONTAINER}
          tabIndex={0}
          // Minimal keyboard support (ARIA-hidden parts are ignored by screen readers).
          onKeyDown={(e) => {
            if (e.key === 'Enter') window.open(`#${item.id}`, '_blank');
          }}
        >
          <span style={LABEL} title={item.label} aria-label={`${item.label} (${item.status})`}>
            {item.label}
          </span>
          <span style={BAR_CONTAINER}>
            <span
              style={[
                PROGRESS_BAR_BG,
                { width: `${calculatePct(item.completed, item.total)}%` },
              ]}
              role="progressbar"
              aria-valuenow={calculatePct(item.completed, item.total)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${item.label} progress`}
            />
          </span>
          <span style={PERC}>
            {item.completed}/{item.total}
          </span>
          <span aria-label={`${item.label} status: ${item.status}`}>
            <StatusBadge status={item.status} />
          </span>
        </div>
      ))}
    </div>
  );
}

// ProgressListProgress exports.
export { calculatePct, getStatusColor };
export type { ProgressItem, PList, SortBy };

// CenPol: private helpers (no public API).
function calculatePct(completed: number, total: number): number {
  if (total <= 0) return 0;
  let pct = (completed / total) * 100;
  if (Number.isNaN(pct)) return 0; // FR-2 (total=0).
  return Math.max(0, Math.min(100, pct));
}

function getStatusColor(status: string): CSSProperties['color'] {
  switch (status) {
    case 'completed': return COLOR_SUCCESS;
    case 'in_progress': return COLOR_PRIMARY;
    case 'blocked': return COLOR_DANGER;
    case 'not_started':
    default: return COLOR_NEUTRAL;
  }
}

// Styles.
const ROW_CONTAINER: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  height: '36px',
  width: '100%',
};

const LABEL: CSSProperties = {
  fontSize: '0.84rem',
  fontWeight: 600,
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: '120px',
  maxWidth: '300px',
  // Force truncation if width is constrained; not dependent on layout, inlined per FR-3.
  // FR-3: No horizontal scroll within list container; paddingBottom keeps row height consistent.
  display: 'inline-block',
  flex: '0 0 auto',
};

const PERC: CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  width: '50px',
  textAlign: 'right',
  flex: '0 0 auto',
  minWidth: LABEL_TRUNCATE_MIN_WIDTH,
};

const BAR_CONTAINER: CSSProperties = {
  position: 'relative',
  height: `${BAR_HEIGHT_COMPONENT_MIN}px`,
  flex: 1,
  minWidth: LABEL_TRUNCATE_MIN_WIDTH,
  overflow: 'hidden',
  display: 'flex',
};

const PROGRESS_BAR_BG: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  bottom: 0,
  borderRadius: '999px',
  backgroundColor: 'var(--border-subtle)',
  opacity: 0.3,
  zIndex: 0,
};
const PROGRESS_BAR_FG: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  height: '100%',
  borderRadius: '999px',
  zIndex: 1,
  // Partial width controlled directly; no JS-triggered animation to avoid mocking window.resize.
  transition: 'width 200ms linear',
};

// StatusBadge for CompactListProgress (not an import to avoid dependency on StatusBadge; FR-8 requires self-contained).
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
      wrapStyle = { ...wrapStyle, backgroundColor: COLOR_SUCCESS };
      break;
    case 'in_progress':
      wrapStyle = { ...wrapStyle, backgroundColor: COLOR_PRIMARY };
      break;
    case 'blocked':
      wrapStyle = { ...wrapStyle, backgroundColor: COLOR_DANGER };
      break;
    case 'not_started':
    default:
      wrapStyle = { ...wrapStyle, backgroundColor: COLOR_NEUTRAL };
      break;
  }
  return <span style={wrapStyle} aria-label={`Status: ${status}`}>{status.replace(/_/g, ' ')}</span>;
}

const EMPTY_STATE: CSSProperties = {
  fontSize: '0.9rem',
  color: 'var(--text-muted)',
  textAlign: 'center',
  padding: '24px 0',
  fontStyle: 'italic',
};