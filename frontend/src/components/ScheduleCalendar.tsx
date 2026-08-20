'use client';

import { useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  DEADLINE_COLORS,
  daysBetween,
  getSchedule,
  parseDate,
  sameDay,
  shiftSchedule,
  startOfDay,
  type ReschedulePatch,
  type Schedulable,
} from '@/lib/schedule';
import { useScheduleDrag } from '@/lib/useScheduleDrag';
import { ScheduleLegend } from './ScheduleLegend';
import { useFormat } from '@/i18n/useFormat';

/**
 * Month calendar of item schedules, generic over any {@link Schedulable} item (a
 * project, a task, …).
 *
 * An item is plotted as a SPAN across every day from its start to its deadline —
 * not as a single pill on the deadline. A month view that showed only the due
 * date answered "what lands on the 14th" and could not answer "what is in
 * flight on the 14th", which is the question a month grid exists for: a
 * three-week project appeared on the calendar as one dot, indistinguishable from
 * a same-day task. Items carrying only a deadline still render as a one-day
 * span, so nothing that used to appear has stopped appearing.
 *
 * Items with no dates at all are surfaced in a footer so they are not silently
 * dropped. When `onReschedule` is supplied, a span can be DRAGGED to a new day
 * and the whole window moves with it; without it the view is read-only.
 */
interface ScheduleCalendarProps<T extends Schedulable & { id: string | number }> {
  items: T[];
  /** Human label for an item (e.g. project name, task title). */
  getLabel: (item: T) => string;
  onSelect: (item: T) => void;
  /**
   * Optional health/status accent for an item, surfaced as a coloured dot on its
   * span so the calendar carries the same at-a-glance health signal as the card
   * and list views. Return undefined to omit the dot (e.g. items with no data).
   */
  getAccentColor?: (item: T) => string | undefined;
  /** Persist a dragged span's new dates. Omit for a read-only calendar. */
  onReschedule?: (item: T, patch: ReschedulePatch) => void;
}

const DAYS_IN_GRID = 42;
const COLS = 7;
/** Height of the date-number row inside each day cell. */
const DATE_ROW_H = 26;
/** Height of one span lane (bar + gap). */
const LANE_H = 20;
/**
 * Lanes drawn per day before the rest collapse into a "+N more" count.
 *
 * A month cell that grows without limit stops being a month view — twelve
 * overlapping projects would push a single week row taller than the viewport.
 * Three is what fits at the 96px minimum column width the grid already uses.
 */
const MAX_LANES = 3;
const MIN_CELL_H = 104;

function buildMonthGrid(viewMonth: Date): Date[] {
  const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay()); // back up to the Sunday on/ before the 1st
  // 6 weeks always rendered for a stable height.
  return Array.from({ length: DAYS_IN_GRID }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

/** One item's bar within one week row. */
interface WeekSpan<T> {
  item: T;
  /** 0..6 — the weekday column the bar starts in. */
  col: number;
  /** 1..7 — how many columns it covers in THIS week. */
  span: number;
  /** The bar reaches beyond this week on that side (drawn square, not rounded). */
  continuesLeft: boolean;
  continuesRight: boolean;
  lane: number;
  color: string;
  /** The item's own window, for the hover title (not this segment's slice). */
  start: Date;
  end: Date;
}

export function ScheduleCalendar<T extends Schedulable & { id: string | number }>({
  items,
  getLabel,
  onSelect,
  getAccentColor,
  onReschedule,
}: ScheduleCalendarProps<T>) {
  const fmt = useFormat();
  const locale = useLocale();
  const t = useTranslations('schedule');
  const today = startOfDay(new Date());
  const [viewMonth, setViewMonth] = useState<Date>(new Date(today.getFullYear(), today.getMonth(), 1));
  const gridRef = useRef<HTMLDivElement | null>(null);

  const days = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);

  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(viewMonth),
    [locale, viewMonth],
  );
  /** Weekday headers in the ACTIVE locale, derived from the grid's own first week
   *  so the labels can never drift from the columns they sit above. */
  const weekdayLabels = useMemo(() => {
    const wd = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return days.slice(0, COLS).map((d) => wd.format(d));
  }, [locale, days]);

  const editable = Boolean(onReschedule);
  const { drag, begin, consumedClick } = useScheduleDrag<T>({
    enabled: editable,
    // The month grid is uniform — 7 equal columns by 6 equal rows — so a pointer
    // position converts to a day INDEX by geometry alone. That is deliberately
    // not "horizontal travel ÷ column width" the way the Gantt does it: a month
    // grid wraps, so dragging from Saturday to the Sunday below moves one day
    // forward while travelling six columns backwards.
    deltaFor: (origin, current) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return 0;
      const indexAt = (x: number, y: number) => {
        const col = Math.min(COLS - 1, Math.max(0, Math.floor(((x - rect.left) / rect.width) * COLS)));
        const rows = DAYS_IN_GRID / COLS;
        const row = Math.min(rows - 1, Math.max(0, Math.floor(((y - rect.top) / rect.height) * rows)));
        return row * COLS + col;
      };
      return indexAt(current.x, current.y) - indexAt(origin.x, origin.y);
    },
    commit: (item, _mode, deltaDays) => {
      const patch = shiftSchedule(item, 'move', deltaDays);
      if (patch) onReschedule?.(item, patch);
    },
  });

  /**
   * Lay every dated item out as week-row spans with non-overlapping lanes, plus
   * the per-day count of what did not fit.
   *
   * Greedy first-fit over items sorted by start (longest first on a tie), which
   * is the standard month-calendar packing: it keeps a long bar on one lane for
   * its whole life instead of letting it jump rows week to week.
   */
  const { spansByWeek, overflowByDay, laneCount } = useMemo(() => {
    const gridStart = days[0]!;
    const dated = items
      .map((item) => ({ item, schedule: getSchedule(item, today) }))
      .filter((s) => s.schedule.start && s.schedule.end)
      .map((s) => ({
        item: s.item,
        color: DEADLINE_COLORS[s.schedule.status],
        start: s.schedule.start!,
        end: s.schedule.end!,
        from: daysBetween(gridStart, s.schedule.start!),
        to: daysBetween(gridStart, s.schedule.end!),
      }))
      // Guard a corrupt row (end before start) rather than rendering a negative bar.
      .map((s) => ({ ...s, to: Math.max(s.from, s.to) }))
      .filter((s) => s.to >= 0 && s.from < DAYS_IN_GRID)
      .sort((a, b) => a.from - b.from || (b.to - b.from) - (a.to - a.from));

    // lanes[laneIndex][dayIndex] = taken.
    const lanes: boolean[][] = [];
    const overflow = new Array<number>(DAYS_IN_GRID).fill(0);
    const weeks: Array<Array<WeekSpan<T>>> = Array.from({ length: DAYS_IN_GRID / COLS }, () => []);
    let maxLane = 0;

    for (const s of dated) {
      const from = Math.max(0, s.from);
      const to = Math.min(DAYS_IN_GRID - 1, s.to);
      let lane = 0;
      while (lanes[lane]?.slice(from, to + 1).some(Boolean)) lane += 1;
      if (!lanes[lane]) lanes[lane] = new Array<boolean>(DAYS_IN_GRID).fill(false);
      for (let d = from; d <= to; d++) lanes[lane]![d] = true;

      if (lane >= MAX_LANES) {
        for (let d = from; d <= to; d++) overflow[d] = (overflow[d] ?? 0) + 1;
        continue;
      }
      maxLane = Math.max(maxLane, lane);

      // Split the run at week boundaries — a bar cannot cross a row.
      for (let d = from; d <= to; ) {
        const week = Math.floor(d / COLS);
        const col = d % COLS;
        const weekEnd = Math.min(to, week * COLS + COLS - 1);
        weeks[week]!.push({
          item: s.item,
          col,
          span: weekEnd - d + 1,
          continuesLeft: d > s.from,
          continuesRight: weekEnd < s.to,
          lane,
          color: s.color,
          start: s.start,
          end: s.end,
        });
        d = weekEnd + 1;
      }
    }

    return { spansByWeek: weeks, overflowByDay: overflow, laneCount: Math.min(MAX_LANES, maxLane + 1) };
  }, [items, days, today]);

  const undated = items.filter((p) => !parseDate(p.dueDate) && !parseDate(p.startDate));

  const goMonth = (delta: number) =>
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  const headerBtn: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: 'var(--font-size-small)',
    fontWeight: 600,
    background: 'var(--bg-base)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
  };

  const cellHeight = Math.max(MIN_CELL_H, DATE_ROW_H + laneCount * LANE_H + 26);
  /** Columns the whole grid shifts by while a span is being dragged. */
  const dragDelta = drag ? drag.deltaDays : 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => goMonth(-1)} style={headerBtn} aria-label={t('prevMonth')}>←</button>
          <div style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)', minWidth: 160, textAlign: 'center' }}>
            {monthLabel}
          </div>
          <button type="button" onClick={() => goMonth(1)} style={headerBtn} aria-label={t('nextMonth')}>→</button>
          <button type="button" onClick={() => setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1))} style={headerBtn}>
            {t('today')}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {editable && <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('dragHintCalendar')}</span>}
          <ScheduleLegend />
        </div>
      </div>

      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {/* Scroll the 7-column grid horizontally on narrow viewports instead of
            squishing each day below a usable width and clipping its spans. */}
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 672 }}>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, minmax(96px, 1fr))` }}>
              {weekdayLabels.map((wd, i) => (
                <div key={i} style={{ padding: '8px 10px', fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
                  {wd}
                </div>
              ))}
            </div>

            {/* The day grid and the span overlay share this box, so a bar's
                percentage geometry lines up with the columns underneath it — and
                so one rect converts a pointer position to a day index. */}
            <div ref={gridRef} style={{ position: 'relative' }}>
              {spansByWeek.map((weekSpans, week) => (
                <div key={week} style={{ position: 'relative', height: cellHeight }}>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, minmax(96px, 1fr))`, height: '100%' }}>
                    {days.slice(week * COLS, week * COLS + COLS).map((day, col) => {
                      const dayIndex = week * COLS + col;
                      const inMonth = day.getMonth() === viewMonth.getMonth();
                      const isToday = sameDay(day, today);
                      const hidden = overflowByDay[dayIndex] ?? 0;
                      return (
                        <div
                          key={day.toISOString()}
                          style={{
                            padding: 6,
                            borderRight: '1px solid var(--border-subtle)',
                            borderBottom: '1px solid var(--border-subtle)',
                            background: inMonth ? 'transparent' : 'var(--bg-base)',
                            opacity: inMonth ? 1 : 0.55,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 22,
                              height: 22,
                              fontSize: 'var(--font-size-small)',
                              fontWeight: isToday ? 700 : 500,
                              borderRadius: '50%',
                              color: isToday ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                              background: isToday ? 'var(--coral-bright)' : 'transparent',
                              flexShrink: 0,
                            }}
                          >
                            {day.getDate()}
                          </div>
                          {hidden > 0 && (
                            <div style={{ fontSize: 'var(--font-size-eyebrow)', fontWeight: 600, color: 'var(--text-muted)' }}>
                              {t('moreItems', { n: hidden })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ position: 'absolute', top: DATE_ROW_H, left: 0, right: 0, pointerEvents: 'none' }}>
                    {weekSpans.map((s) => {
                      const dragging = drag?.item.id === s.item.id;
                      const shift = dragging ? dragDelta : 0;
                      const label = getLabel(s.item);
                      const accent = getAccentColor?.(s.item);
                      const roundLeft = !s.continuesLeft;
                      const roundRight = !s.continuesRight;
                      return (
                        <div
                          key={`${s.item.id}-${s.col}`}
                          role="button"
                          tabIndex={0}
                          aria-label={editable ? t('spanAriaEditable', { label }) : label}
                          title={`${label} — ${fmt.date(s.start)} → ${fmt.date(s.end)}`}
                          onPointerDown={(e) => begin(e, s.item, 'move')}
                          onClick={() => { if (!consumedClick()) onSelect(s.item); }}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.item); } }}
                          style={{
                            position: 'absolute',
                            top: s.lane * LANE_H,
                            left: `calc(${((s.col + shift) / COLS) * 100}% + 3px)`,
                            width: `calc(${(s.span / COLS) * 100}% - 6px)`,
                            height: LANE_H - 4,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '0 6px',
                            fontSize: 'var(--font-size-eyebrow)',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            background: 'var(--bg-base)',
                            border: '1px solid var(--border-subtle)',
                            borderLeft: `3px solid ${s.color}`,
                            borderTopLeftRadius: roundLeft ? 'var(--radius-sm)' : 0,
                            borderBottomLeftRadius: roundLeft ? 'var(--radius-sm)' : 0,
                            borderTopRightRadius: roundRight ? 'var(--radius-sm)' : 0,
                            borderBottomRightRadius: roundRight ? 'var(--radius-sm)' : 0,
                            cursor: editable ? (dragging ? 'grabbing' : 'grab') : 'pointer',
                            opacity: dragging ? 0.7 : 1,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            pointerEvents: 'auto',
                            touchAction: editable ? 'none' : undefined,
                            userSelect: 'none',
                            zIndex: dragging ? 3 : 2,
                          }}
                        >
                          {accent && (
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent, flexShrink: 0 }} aria-hidden />
                          )}
                          {/* Only the leading segment carries the name; a bar
                              continued from the previous week repeating its own
                              title once a week reads as several items. */}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.continuesLeft ? '' : label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {undated.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('noDeadline')}</span>
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
                  fontSize: 'var(--font-size-small)',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-full)',
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
