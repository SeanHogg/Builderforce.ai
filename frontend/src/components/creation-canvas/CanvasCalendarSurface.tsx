/*
 * No `'use client'` here on purpose. This is imported only by `CreationCanvas.tsx`, which
 * already declares the boundary, so a directive would mark a second entry point that does
 * not exist — and `check-frontend-architecture` counts directives, not components.
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { calendarConflicts, calendarEntriesFrom, type CalendarEntry } from '@builderforce/creation-canvas-contract';
import { creationObjectDefinition } from './creationObjectRegistry';
import styles from './CreationCanvas.module.css';
import type { CreationNodeData } from './types';

/**
 * THE MONTH. The board's dates, drawn on the axis the board never had.
 *
 * ── WHY THIS IS A SURFACE AND NOT A `campaignCalendar` KIND ──────────────────────
 * `socialCampaign`, `emailCampaign` and `salesMeeting` have carried `scheduledAt` since
 * they shipped, and every spec kind that carries a deadline already declares which field
 * holds it. Nothing was missing except a reading: scheduled work was discoverable only by
 * finding the card, so the CMO's primary planning artifact — the month — could not be
 * drawn on the surface that plans the month.
 *
 * A `campaignCalendar` OBJECT would have been the wrong answer, and expensively so: it
 * would hold a second copy of dates that already exist on the cards, and the first time
 * somebody moved a send the two would disagree with no way to tell which was true. So
 * this surface owns no data. It folds the board (`calendarEntriesFrom`) and writes a drag
 * straight back into the field the date came from.
 *
 * ── WHY IT IS BOARD-SCOPED ───────────────────────────────────────────────────────
 * `page`, `play`, `site`, `timeline` and `world` each open ONE card at full size. A month
 * is about every card at once, which is the same argument the `app` surface makes: there
 * is no card to enter it from, so it belongs in the rail where pressing it with nothing
 * selected has an answer.
 *
 * ── CONFLICTS, AND WHY THEY ARE PART OF THE READING ──────────────────────────────
 * Two emails to one list on one morning is the thing a content calendar exists to catch;
 * an email and a sales meeting on one afternoon is a normal Tuesday. `calendarConflicts`
 * draws that line once, in the contract, on channel and day — so what this surface marks
 * and what any future digest counts cannot disagree.
 */

const DAY_MS = 86_400_000;

/** Monday-first weeks. The ISO week is what a working month is planned on, and starting
 *  on Sunday would put the two days nobody schedules a send on either side of the grid. */
function startOfGrid(monthStart: Date): Date {
  const start = new Date(monthStart);
  const weekday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - weekday);
  start.setHours(0, 0, 0, 0);
  return start;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export interface CanvasCalendarSurfaceProps {
  nodes: ReadonlyArray<{ id: string; data: CreationNodeData }>;
  /** Escape hands the board back. No exit BUTTON, for the reason the app surface gives:
   *  this one is in the rail, so pressing "Calendar" again is the way out. */
  onExit: () => void;
  /** Send the reader to the card a date came from. */
  onOpenObject?: (nodeId: string) => void;
  /**
   * Move a scheduled object to another day.
   *
   * Writes back into the FIELD the date was read from — `scheduledAt` for a commitment,
   * whichever deadline field the kind declared otherwise — which is why the surface can
   * be a projection rather than a store. Absent on a read-only board, and the grid then
   * renders without drag targets rather than accepting a drop it will silently discard.
   */
  onReschedule?: (nodeId: string, field: string, iso: string) => void;
}

export function CanvasCalendarSurface({ nodes, onExit, onOpenObject, onReschedule }: CanvasCalendarSurfaceProps) {
  const t = useTranslations('creationCanvas.surface.calendar');
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const entries = useMemo(
    () => calendarEntriesFrom(nodes.map((node) => ({
      id: node.id,
      kind: node.data.kind,
      title: node.data.title ?? null,
      data: node.data as unknown as Record<string, unknown>,
    }))),
    [nodes],
  );
  const conflicts = useMemo(() => calendarConflicts(entries), [entries]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      const key = new Date(entry.at).toISOString().slice(0, 10);
      const bucket = map.get(key);
      if (bucket) bucket.push(entry); else map.set(key, [entry]);
    }
    return map;
  }, [entries]);

  const gridStart = useMemo(() => startOfGrid(cursor), [cursor]);
  const days = useMemo(
    () => Array.from({ length: 42 }, (_, index) => new Date(gridStart.getTime() + index * DAY_MS)),
    [gridStart],
  );
  const todayKey = new Date().toISOString().slice(0, 10);
  const undated = nodes.length - entries.length;

  const move = (monthDelta: number) =>
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + monthDelta, 1));

  return (
    <section
      className={styles.appSurface}
      aria-label={t('regionLabel')}
      onKeyDown={(event) => { if (event.key === 'Escape') onExit(); }}
    >
      <header className={styles.calendarHeader}>
        <div className={styles.calendarNav} role="group" aria-label={t('navLabel')}>
          <button type="button" onClick={() => move(-1)} aria-label={t('previousMonth')}>‹</button>
          <b>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(cursor)}</b>
          <button type="button" onClick={() => move(1)} aria-label={t('nextMonth')}>›</button>
        </div>
        <p className={styles.calendarSummary}>
          {t('summary', { scheduled: entries.filter((entry) => entry.scheduled).length, dated: entries.length, undated: Math.max(0, undated) })}
        </p>
      </header>

      <div className={styles.appSurfaceBody}>
        <div className={styles.calendarWeekdays} aria-hidden>
          {days.slice(0, 7).map((day) => (
            <span key={day.toISOString()}>{new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(day)}</span>
          ))}
        </div>
        <div className={styles.calendarGrid} role="grid" aria-label={t('gridLabel')}>
          {days.map((day) => {
            const key = day.toISOString().slice(0, 10);
            const cell = byDay.get(key) ?? [];
            return (
              <div
                key={key}
                role="gridcell"
                className={styles.calendarDay}
                data-outside={monthKey(day) !== monthKey(cursor)}
                data-today={key === todayKey}
                onDragOver={onReschedule ? (event) => event.preventDefault() : undefined}
                onDrop={onReschedule ? (event) => {
                  event.preventDefault();
                  const payload = event.dataTransfer.getData('application/x-canvas-calendar');
                  if (!payload) return;
                  const [nodeId, field] = payload.split('|');
                  if (nodeId && field) onReschedule(nodeId, field, `${key}T09:00:00.000Z`);
                } : undefined}
              >
                <small>{day.getDate()}</small>
                {cell.map((entry) => (
                  <button
                    key={`${entry.id}:${entry.field}`}
                    type="button"
                    className={styles.calendarEntry}
                    data-scheduled={entry.scheduled}
                    data-conflict={conflicts.has(entry.id)}
                    draggable={Boolean(onReschedule)}
                    onDragStart={(event) => event.dataTransfer.setData('application/x-canvas-calendar', `${entry.id}|${entry.field}`)}
                    onClick={() => onOpenObject?.(entry.id)}
                    title={conflicts.has(entry.id) ? t('conflict') : undefined}
                  >
                    <span aria-hidden>{creationObjectDefinition(entry.kind as CreationNodeData['kind']).icon}</span>
                    <span className={styles.calendarEntryTitle}>{entry.title}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
