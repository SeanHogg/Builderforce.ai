'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CalendarEvent } from '@builderforce/creation-canvas-contract';
import {
  meetingsApi, calendarApi,
  type MeetingDetail, type CalendarEventItem, type AvailabilityProfile,
} from '@/lib/builderforceApi';
import { Calendar } from '@/components/calendar/Calendar';
import { ScheduleMeetingPanel } from './ScheduleMeetingPanel';
import { AvailabilityEditor } from './AvailabilityEditor';
import { MeetingRoom } from './MeetingRoom';
import styles from './MeetingsCalendar.module.css';

/**
 * The bookable calendar — meetings, connected-calendar events, and the reader's own
 * availability shaded behind them.
 *
 * ── WHY THIS NO LONGER DRAWS A GRID ──────────────────────────────────────────────
 * It used to carry two of its own: a `MonthGrid` and a `WeekGrid`, both in inline style,
 * with their own day cells, their own hour rows, their own `+N` overflow and their own
 * absolutely-positioned event blocks whose left offset was a hand-written
 * `calc(52px + 2px + i * (…))`. That was the third month grid in this codebase, after
 * `ScheduleCalendar` and the canvas one. There is one now, and it is
 * `components/calendar/Calendar.tsx`.
 *
 * What is left here is what is genuinely about MEETINGS and belongs to no calendar:
 *   • the reading — app meetings unioned with connected-calendar events, cancelled ones
 *     dropped, each coloured by what it IS (live, scheduled, external);
 *   • the AVAILABILITY projection, which is the one thing a general calendar cannot own:
 *     windows are stored in the owner's DECLARED timezone, so a grid cell — a viewer-local
 *     instant — has to be projected into that zone before the windows are tested, exactly
 *     as the server's own "find a time" solver does. Passed down as `slotShading`, which
 *     takes an instant and returns a background, so the calendar never learns what a
 *     timezone is;
 *   • the three things a click can MEAN here — join a meeting, open an external entry,
 *     book a slot — which is why `onSelectEvent` is supplied and the calendar's own
 *     detail panel stands down;
 *   • the booking panel, the availability editor and the room, which it has always driven.
 *
 * Still self-contained: it drives its own data, its own modals and its own entitlements,
 * so it drops into any surface (Workforce tab, Portfolio panel) unchanged.
 */
export function MeetingsCalendar({
  projectId = null,
  defaultView = 'week',
  compact = false,
}: {
  projectId?: number | null;
  defaultView?: 'month' | 'week';
  compact?: boolean;
}) {
  const t = useTranslations('meetings');

  const [meetings, setMeetings] = useState<MeetingDetail[]>([]);
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [availability, setAvailability] = useState<AvailabilityProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [bookAt, setBookAt] = useState<string | null>(null);
  const [bookOpen, setBookOpen] = useState(false);
  const [availOpen, setAvailOpen] = useState(false);
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [m, e, a] = await Promise.all([
        meetingsApi.list({ scope: 'all', ...(projectId ? { projectId } : {}) }),
        calendarApi.events(40).catch(() => ({ events: [] as CalendarEventItem[] })),
        meetingsApi.myAvailability().catch(() => null),
      ]);
      setMeetings(m.meetings);
      setEvents(e.events);
      setAvailability(a);
    } finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { void reload(); }, [reload]);

  /** Both readings as one list. A cancelled meeting is dropped rather than greyed: its
   *  slot is free, and drawing it would say otherwise to somebody looking for a time. */
  const calendarEvents = useMemo<readonly CalendarEvent[]>(() => {
    const out: CalendarEvent[] = [];
    for (const detail of meetings) {
      const meeting = detail.meeting;
      if (meeting.status === 'cancelled') continue;
      const startMs = meeting.scheduledAt
        ? Date.parse(meeting.scheduledAt)
        : (meeting.startedAt ? Date.parse(meeting.startedAt) : NaN);
      if (!Number.isFinite(startMs)) continue;
      out.push({
        id: `m:${meeting.id}`,
        ref: meeting.id,
        subject: meeting.title,
        startISO: new Date(startMs).toISOString(),
        endISO: new Date(startMs + meeting.durationMinutes * 60_000).toISOString(),
        category: meeting.kind,
        color: meeting.status === 'live' ? 'var(--coral-bright)' : 'var(--cyan-bright)',
        ...(meeting.description ? { details: meeting.description } : {}),
      });
    }
    for (const event of events) {
      const startMs = Date.parse(event.startISO);
      if (!Number.isFinite(startMs)) continue;
      const endMs = Date.parse(event.endISO);
      out.push({
        id: `e:${event.provider}:${event.id}`,
        subject: event.title,
        startISO: event.startISO,
        endISO: new Date(Number.isFinite(endMs) ? endMs : startMs + 30 * 60_000).toISOString(),
        category: event.provider,
        color: 'var(--violet-bright)',
        ...(event.location ? { location: event.location } : {}),
        ...(event.htmlLink ? { url: event.htmlLink } : {}),
        readOnly: true,
      });
    }
    return out;
  }, [meetings, events]);

  /**
   * Which slots the reader is bookable in.
   *
   * The windows live in the owner's DECLARED timezone, so an instant is projected into
   * that zone before the windows are tested — otherwise the shading is offset by the
   * difference whenever the browser's zone is not the declared one. This is the mirror of
   * the server solver's own projection, and it is the reason this lives here rather than
   * in the calendar: it is a fact about a PERSON, not about a grid.
   */
  const availByDay = useMemo(() => {
    const map = new Map<number, Array<{ start: number; end: number }>>();
    for (const window of availability?.windows ?? []) {
      const list = map.get(window.day) ?? [];
      list.push({ start: window.start, end: window.end });
      map.set(window.day, list);
    }
    return map;
  }, [availability]);
  const availTz = availability?.timezone;

  const slotShading = useCallback((instantMs: number) => {
    if (availByDay.size === 0) return undefined;
    const { day, minutes } = localPartsInTz(instantMs, availTz);
    const open = (availByDay.get(day) ?? []).some((w) => minutes >= w.start && minutes < w.end);
    return open ? { background: 'var(--success-bg)', label: t('available') } : undefined;
  }, [availByDay, availTz, t]);

  const openBook = (at: Date | null) => { setBookAt(at ? at.toISOString() : null); setBookOpen(true); };

  /** The three things a click can mean here — which is why the calendar's own detail
   *  panel stands down: a panel that could not join a meeting would be the worse half of
   *  a control that already exists. */
  const select = useCallback((event: CalendarEvent) => {
    if (event.ref) { setActiveMeetingId(event.ref); return; }
    if (event.url) window.open(event.url, '_blank', 'noopener,noreferrer');
  }, []);

  return (
    <div className={styles.wrap} data-compact={compact ? '' : undefined}>
      <Calendar
        events={calendarEvents}
        variant="full"
        defaultView={defaultView}
        loading={loading}
        label={t('calendarLabel')}
        slotShading={slotShading}
        onSelectEvent={select}
        // Empty space books a meeting. Supplying `onCreate` is also what makes the
        // calendar offer its "New meeting" control, so there is one way in, not two.
        onCreate={(draft) => {
          openBook(new Date(draft.startISO.length <= 10 ? `${draft.startISO}T09:00` : draft.startISO));
        }}
        toolbar={
          <button type="button" className={styles.ghost} onClick={() => setAvailOpen(true)}>
            {t('myAvailability')}
          </button>
        }
        footer={
          <>
            <Legend color="var(--cyan-bright)" label={t('legendScheduled')} />
            <Legend color="var(--coral-bright)" label={t('legendLive')} />
            <Legend color="var(--violet-bright)" label={t('legendCalendar')} />
            <Legend color="var(--success-bg)" label={t('legendAvailable')} border />
          </>
        }
      />

      <ScheduleMeetingPanel
        open={bookOpen}
        onClose={() => setBookOpen(false)}
        onCreated={(detail, joinNow) => {
          setMeetings((prev) => [detail, ...prev]);
          if (joinNow) setActiveMeetingId(detail.meeting.id);
          void reload();
        }}
        presetAt={bookAt}
        projectId={projectId}
      />
      {availOpen && (
        <AvailabilityEditor
          initial={availability}
          onClose={() => setAvailOpen(false)}
          onSaved={(a) => { setAvailability(a); setAvailOpen(false); }}
        />
      )}
      {activeMeetingId && (
        <MeetingRoom meetingId={activeMeetingId} onClose={() => { setActiveMeetingId(null); void reload(); }} />
      )}
    </div>
  );
}

function Legend({ color, label, border }: { color: string; label: string; border?: boolean }) {
  return (
    <span className={styles.legend}>
      <span
        className={styles.swatch}
        style={{ background: color, ...(border ? { borderColor: 'var(--success-border)' } : {}) }}
      />
      {label}
    </span>
  );
}

/**
 * Local weekday (0=Sun) + minutes-from-midnight of an instant in a given IANA timezone —
 * mirrors the server solver's projection so the availability shading matches "find a
 * time". Falls back to browser-local on an invalid or unknown zone.
 */
function localPartsInTz(instantMs: number, timezone: string | undefined): { day: number; minutes: number } {
  if (timezone) {
    try {
      // `'en-US'` is deliberate and must NOT follow the reader: the weekday parts are
      // KEYS into the map below, not text anyone sees. A localized formatter would emit
      // 'Mo' / '週一' and every lookup would miss.
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date(instantMs));
      const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
      let hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
      if (hour === 24) hour = 0;
      const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
      return { day: DAYS[weekday] ?? 0, minutes: hour * 60 + minute };
    } catch { /* fall through to browser-local */ }
  }
  const date = new Date(instantMs);
  return { day: date.getDay(), minutes: date.getHours() * 60 + date.getMinutes() };
}
