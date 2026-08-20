'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  DEADLINE_COLORS,
  daysBetween,
  formatShort,
  parseDate,
  scheduledItems,
  shiftSchedule,
  startOfDay,
  type ReschedulePatch,
  type Schedulable,
} from '@/lib/schedule';
import { useScheduleDrag } from '@/lib/useScheduleDrag';
import { ScheduleLegend } from './ScheduleLegend';

/**
 * Horizontal Gantt of item timelines (start → deadline), generic over any
 * {@link Schedulable} item (a project, a task, …). Bars are colored by deadline
 * status; a "today" marker and month axis give context. Items with no dates are
 * listed below so they are not silently dropped. Reused by Projects and Tasks.
 *
 * When `onReschedule` is supplied the bars become DRAGGABLE: the body slides the
 * whole window, and the two edge grips move one end each. Without it the view
 * stays exactly as read-only as it was — a caller with no write path passes
 * nothing and gets no grips, rather than grips that silently fail.
 */
interface ScheduleGanttProps<T extends Schedulable & { id: string | number }> {
  items: T[];
  /** Human label for an item (e.g. project name, task title). */
  getLabel: (item: T) => string;
  onSelect: (item: T) => void;
  /**
   * Header for the name column and the full empty-state sentence, both already
   * LOCALIZED by the caller.
   *
   * These used to be one English `noun` prop that this component capitalized and
   * pluralized with `+ 's'`. That is only ever correct in English: "1 projet"
   * pluralizes as "projets", "Aufgabe" as "Aufgaben", and Chinese does not
   * pluralize at all — so the empty state read "No scheduled tâches yet" the
   * moment the surrounding page was translated. Grammar belongs in the catalog,
   * next to the sentence it inflects, not in a shared component's string maths.
   */
  columnLabel: string;
  emptyMessage: string;
  /** Persist a dragged bar's new dates. Omit for a read-only timeline. */
  onReschedule?: (item: T, patch: ReschedulePatch) => void;
}

const PX_PER_DAY = 26;
const NAME_COL = 200;
const ROW_H = 38;
const BAR_H = 20;
/** Width of each resize grip. Wide enough to hit with a finger, narrow enough
 *  that a short bar still has a draggable middle. */
const GRIP_W = 8;
const DAY_MS = 86_400_000;

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
  columnLabel,
  emptyMessage,
  onReschedule,
}: ScheduleGanttProps<T>) {
  const t = useTranslations('schedule');
  const scheduled = useMemo(() => scheduledItems(items), [items]);
  const undated = items.filter((p) => !parseDate(p.dueDate) && !parseDate(p.startDate));

  const editable = Boolean(onReschedule);
  const { drag, begin, consumedClick } = useScheduleDrag<T>({
    enabled: editable,
    // One Gantt column IS one day, so horizontal travel converts directly.
    deltaFor: (origin, current) => Math.round((current.x - origin.x) / PX_PER_DAY),
    commit: (item, mode, deltaDays) => {
      const patch = shiftSchedule(item, mode, deltaDays);
      if (patch) onReschedule?.(item, patch);
    },
  });

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

  if (!range) {
    return (
      <div style={{ padding: 32, textAlign: 'center', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', color: 'var(--text-secondary)' }}>
        {emptyMessage}
      </div>
    );
  }

  const totalDays = daysBetween(range.start, range.end) + 1;
  const timelineWidth = totalDays * PX_PER_DAY;
  const segments = monthSegments(range.start, range.end);
  const today = startOfDay(new Date());
  const todayOffset = daysBetween(range.start, today);
  const todayInRange = todayOffset >= 0 && todayOffset < totalDays;

  /** The in-flight day shift for this item's left edge / width, mid-drag. */
  const previewFor = (id: string | number): { offset: number; width: number } => {
    if (!drag || drag.item.id !== id) return { offset: 0, width: 0 };
    if (drag.mode === 'move') return { offset: drag.deltaDays, width: 0 };
    if (drag.mode === 'start') return { offset: drag.deltaDays, width: -drag.deltaDays };
    return { offset: 0, width: drag.deltaDays };
  };

  const gripStyle = (side: 'left' | 'right'): React.CSSProperties => ({
    position: 'absolute',
    top: 0,
    bottom: 0,
    [side]: 0,
    width: GRIP_W,
    cursor: 'ew-resize',
    // A faint inset rule so the grips read as handles in both themes without a
    // hardcoded colour — the bar underneath is already status-coloured, and
    // --text-on-accent is the token guaranteed to contrast against it.
    borderLeft: side === 'right' ? '1px solid var(--text-on-accent)' : undefined,
    borderRight: side === 'left' ? '1px solid var(--text-on-accent)' : undefined,
    opacity: 0.55,
    touchAction: 'none',
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        {editable && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('dragHintGantt')}</span>}
        <ScheduleLegend />
      </div>

      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: NAME_COL + timelineWidth }}>
            {/* Axis header */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ width: NAME_COL, flexShrink: 0, padding: '8px 12px', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)' }}>
                {columnLabel}
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
                const preview = previewFor(item.id);
                const offset = daysBetween(range.start, schedule.start!) + preview.offset;
                const duration = Math.max(
                  1,
                  daysBetween(schedule.start!, schedule.end!) + 1 + preview.width,
                );
                const color = DEADLINE_COLORS[schedule.status];
                const label = getLabel(item);
                const dragging = drag?.item.id === item.id;
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
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label={editable ? t('barAriaEditable', { label }) : label}
                        onPointerDown={(e) => begin(e, item, 'move')}
                        onClick={() => { if (!consumedClick()) onSelect(item); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(item); } }}
                        title={`${formatShort(schedule.start!)} → ${formatShort(schedule.end!)}`}
                        style={{
                          position: 'absolute',
                          top: (ROW_H - BAR_H) / 2,
                          left: offset * PX_PER_DAY,
                          width: duration * PX_PER_DAY,
                          height: BAR_H,
                          background: color,
                          opacity: dragging ? 0.65 : 0.9,
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          cursor: editable ? (dragging ? 'grabbing' : 'grab') : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          padding: editable ? `0 ${GRIP_W + 2}px` : '0 8px',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          color: 'var(--text-on-accent)',
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          zIndex: 2,
                          // Without this a touch drag scrolls the timeline instead
                          // of moving the bar.
                          touchAction: editable ? 'none' : undefined,
                          userSelect: 'none',
                        }}
                      >
                        {editable && schedule.start && (
                          <span
                            aria-hidden
                            onPointerDown={(e) => begin(e, item, 'start')}
                            style={gripStyle('left')}
                          />
                        )}
                        {formatShort(schedule.end!)}
                        {editable && schedule.end && (
                          <span
                            aria-hidden
                            onPointerDown={(e) => begin(e, item, 'end')}
                            style={gripStyle('right')}
                          />
                        )}
                      </div>
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
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('unscheduled')}</span>
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
                borderRadius: 'var(--radius-full)',
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
