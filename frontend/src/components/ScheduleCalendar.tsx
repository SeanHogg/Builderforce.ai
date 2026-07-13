'use client';

import { useMemo, useState } from 'react';
import {
  DEADLINE_COLORS,
  getSchedule,
  parseDate,
  sameDay,
  startOfDay,
  type Schedulable,
} from '@/lib/schedule';
import { ScheduleLegend } from './ScheduleLegend';

/**
 * Month calendar of deadlines, generic over any {@link Schedulable} item (a
 * project, a task, …). Each item is plotted on its `dueDate`; items with no
 * deadline are surfaced in a footer so they are not silently dropped. Click a
 * pill to open the item. Reused by the Projects and Tasks pages.
 */
interface ScheduleCalendarProps<T extends Schedulable & { id: string | number }> {
  items: T[];
  /** Human label for an item (e.g. project name, task title). */
  getLabel: (item: T) => string;
  onSelect: (item: T) => void;
  /**
   * Optional health/status accent for an item, surfaced as a coloured dot on its
   * pill so the calendar carries the same at-a-glance health signal as the card
   * and list views. Return undefined to omit the dot (e.g. items with no data).
   */
  getAccentColor?: (item: T) => string | undefined;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

function buildMonthGrid(viewMonth: Date): Date[] {
  const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay()); // back up to the Sunday on/ before the 1st
  // 6 weeks always rendered for a stable height.
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

export function ScheduleCalendar<T extends Schedulable & { id: string | number }>({
  items,
  getLabel,
  onSelect,
  getAccentColor,
}: ScheduleCalendarProps<T>) {
  const today = startOfDay(new Date());
  const [viewMonth, setViewMonth] = useState<Date>(new Date(today.getFullYear(), today.getMonth(), 1));

  const days = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);

  // Map day-key -> items whose deadline lands that day.
  const byDay = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const item of items) {
      const due = parseDate(item.dueDate);
      if (!due) continue;
      const key = startOfDay(due).toISOString();
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return map;
  }, [items]);

  const undated = items.filter((p) => !parseDate(p.dueDate));

  const goMonth = (delta: number) =>
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  const headerBtn: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: '0.8rem',
    fontWeight: 600,
    background: 'var(--bg-base)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 8,
    cursor: 'pointer',
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => goMonth(-1)} style={headerBtn} aria-label="Previous month">←</button>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', minWidth: 160, textAlign: 'center' }}>
            {MONTH_FMT.format(viewMonth)}
          </div>
          <button type="button" onClick={() => goMonth(1)} style={headerBtn} aria-label="Next month">→</button>
          <button type="button" onClick={() => setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1))} style={headerBtn}>
            Today
          </button>
        </div>
        <ScheduleLegend />
      </div>

      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
        {/* Scroll the 7-column grid horizontally on narrow viewports instead of
            squishing each day below a usable width and clipping its pills. */}
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(96px, 1fr))', minWidth: 672 }}>
            {WEEKDAYS.map((wd) => (
            <div key={wd} style={{ padding: '8px 10px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
              {wd}
            </div>
          ))}
          {days.map((day) => {
            const inMonth = day.getMonth() === viewMonth.getMonth();
            const isToday = sameDay(day, today);
            const dayItems = byDay.get(startOfDay(day).toISOString()) ?? [];
            return (
              <div
                key={day.toISOString()}
                style={{
                  minHeight: 104,
                  padding: 6,
                  borderRight: '1px solid var(--border-subtle)',
                  borderBottom: '1px solid var(--border-subtle)',
                  background: inMonth ? 'transparent' : 'var(--bg-base)',
                  opacity: inMonth ? 1 : 0.55,
                }}
              >
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 22,
                    height: 22,
                    fontSize: '0.78rem',
                    fontWeight: isToday ? 700 : 500,
                    borderRadius: '50%',
                    marginBottom: 4,
                    color: isToday ? '#fff' : 'var(--text-secondary)',
                    background: isToday ? 'var(--coral-bright)' : 'transparent',
                  }}
                >
                  {day.getDate()}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {dayItems.map((item) => {
                    const status = getSchedule(item).status;
                    const label = getLabel(item);
                    const accent = getAccentColor?.(item);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelect(item)}
                        title={`${label} — due ${day.toLocaleDateString()}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          width: '100%',
                          textAlign: 'left',
                          padding: '2px 6px',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          background: 'var(--bg-base)',
                          border: '1px solid var(--border-subtle)',
                          borderLeft: `3px solid ${DEADLINE_COLORS[status]}`,
                          borderRadius: 5,
                          cursor: 'pointer',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {accent && (
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent, flexShrink: 0 }} aria-hidden />
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </div>

      {undated.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>No deadline set:</span>
          {undated.map((item) => {
            const accent = getAccentColor?.(item);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
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
                {accent && (
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent, flexShrink: 0 }} aria-hidden />
                )}
                {getLabel(item)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
