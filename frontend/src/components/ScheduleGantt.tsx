'use client';

import { useMemo } from 'react';
import {
  DEADLINE_COLORS,
  formatShort,
  parseDate,
  scheduledItems,
  startOfDay,
  type Schedulable,
} from '@/lib/schedule';
import { ScheduleLegend } from './ScheduleLegend';

/**
 * Horizontal Gantt of item timelines (start → deadline), generic over any
 * {@link Schedulable} item (a project, a task, …). Bars are colored by deadline
 * status; a "today" marker and month axis give context. Items with no dates are
 * listed below so they are not silently dropped. Reused by Projects and Tasks.
 */
interface ScheduleGanttProps<T extends Schedulable & { id: string | number }> {
  items: T[];
  /** Human label for an item (e.g. project name, task title). */
  getLabel: (item: T) => string;
  onSelect: (item: T) => void;
  /** Lowercase noun for the row-column header and empty state (e.g. "project", "task"). */
  noun?: string;
}

const PX_PER_DAY = 26;
const NAME_COL = 200;
const ROW_H = 38;
const DAY_MS = 86_400_000;

function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

/** Month segments [{ label, days }] covering [start, end] inclusive, for the axis. */
function monthSegments(start: Date, end: Date): Array<{ label: string; days: number }> {
  const segments: Array<{ label: string; days: number }> = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = startOfDay(end);
  const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' });
  while (cursor <= last) {
    const monthStart = cursor < startOfDay(start) ? startOfDay(start) : cursor;
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const segEnd = monthEnd > last ? last : monthEnd;
    segments.push({ label: fmt.format(cursor), days: daysBetween(monthStart, segEnd) + 1 });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return segments;
}

export function ScheduleGantt<T extends Schedulable & { id: string | number }>({
  items,
  getLabel,
  onSelect,
  noun = 'item',
}: ScheduleGanttProps<T>) {
  const scheduled = useMemo(() => scheduledItems(items), [items]);
  const undated = items.filter((p) => !parseDate(p.dueDate) && !parseDate(p.startDate));

  const range = useMemo(() => {
    if (scheduled.length === 0) return null;
    let min = scheduled[0].schedule.start!;
    let max = scheduled[0].schedule.end!;
    for (const { schedule } of scheduled) {
      if (schedule.start! < min) min = schedule.start!;
      if (schedule.end! > max) max = schedule.end!;
    }
    // Pad a few days on each side so end bars aren't flush to the edge.
    const start = startOfDay(new Date(min.getTime() - 2 * DAY_MS));
    const end = startOfDay(new Date(max.getTime() + 2 * DAY_MS));
    return { start, end };
  }, [scheduled]);

  const colHeader = noun.charAt(0).toUpperCase() + noun.slice(1);

  if (!range) {
    return (
      <div style={{ padding: 32, textAlign: 'center', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, color: 'var(--text-secondary)' }}>
        No scheduled {noun}s yet. Add start or due dates to see them on the timeline.
      </div>
    );
  }

  const totalDays = daysBetween(range.start, range.end) + 1;
  const timelineWidth = totalDays * PX_PER_DAY;
  const segments = monthSegments(range.start, range.end);
  const today = startOfDay(new Date());
  const todayOffset = daysBetween(range.start, today);
  const todayInRange = todayOffset >= 0 && todayOffset < totalDays;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <ScheduleLegend />
      </div>

      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: NAME_COL + timelineWidth }}>
            {/* Axis header */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ width: NAME_COL, flexShrink: 0, padding: '8px 12px', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)' }}>
                {colHeader}
              </div>
              <div style={{ position: 'relative', width: timelineWidth, display: 'flex' }}>
                {segments.map((seg, i) => (
                  <div
                    key={i}
                    style={{
                      width: seg.days * PX_PER_DAY,
                      flexShrink: 0,
                      padding: '8px 8px',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      borderLeft: i === 0 ? 'none' : '1px solid var(--border-subtle)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                    }}
                  >
                    {seg.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Rows */}
            <div style={{ position: 'relative' }}>
              {todayInRange && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: NAME_COL + todayOffset * PX_PER_DAY + PX_PER_DAY / 2,
                    width: 2,
                    background: 'var(--coral-bright)',
                    opacity: 0.55,
                    zIndex: 1,
                  }}
                />
              )}
              {scheduled.map(({ item, schedule }) => {
                const offset = daysBetween(range.start, schedule.start!);
                const duration = Math.max(1, daysBetween(schedule.start!, schedule.end!) + 1);
                const color = DEADLINE_COLORS[schedule.status];
                const label = getLabel(item);
                return (
                  <div key={item.id} style={{ display: 'flex', height: ROW_H, borderBottom: '1px solid var(--border-subtle)' }}>
                    <button
                      type="button"
                      onClick={() => onSelect(item)}
                      title={label}
                      style={{
                        width: NAME_COL,
                        flexShrink: 0,
                        textAlign: 'left',
                        padding: '0 12px',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label}
                    </button>
                    <div style={{ position: 'relative', width: timelineWidth }}>
                      <button
                        type="button"
                        onClick={() => onSelect(item)}
                        title={`${formatShort(schedule.start!)} → ${formatShort(schedule.end!)}`}
                        style={{
                          position: 'absolute',
                          top: (ROW_H - 20) / 2,
                          left: offset * PX_PER_DAY,
                          width: duration * PX_PER_DAY,
                          height: 20,
                          background: color,
                          opacity: 0.9,
                          border: 'none',
                          borderRadius: 6,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0 8px',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          color: '#fff',
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          zIndex: 2,
                        }}
                      >
                        {formatShort(schedule.end!)}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {undated.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Unscheduled:</span>
          {undated.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              style={{
                padding: '3px 10px',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 999,
                cursor: 'pointer',
              }}
            >
              {getLabel(item)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
