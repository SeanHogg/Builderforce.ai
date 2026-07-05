'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import {
  meetingsApi, calendarApi,
  type MeetingDetail, type CalendarEventItem, type AvailabilityProfile,
} from '@/lib/builderforceApi';
import { ViewToggle } from '@/components/ViewToggle';
import { ScheduleMeetingPanel } from './ScheduleMeetingPanel';
import { AvailabilityEditor } from './AvailabilityEditor';
import { MeetingRoom } from './MeetingRoom';

/** A day/time-positioned item on the calendar: an app meeting or a calendar event. */
interface CalItem {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  source: 'meeting' | 'event';
  kind?: string;
  live?: boolean;
  joinable?: boolean;
  meetingId?: string;
  href?: string;
}

const DAY_MS = 86_400_000;
const HOUR_START = 6;   // week grid spans 06:00
const HOUR_END = 22;    // …to 22:00
const SLOT_MIN = 30;

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d: Date): Date { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function sameDay(a: number, b: Date): boolean {
  const d = new Date(a);
  return d.getFullYear() === b.getFullYear() && d.getMonth() === b.getMonth() && d.getDate() === b.getDate();
}

/** Color a calendar item by source/kind (theme tokens). */
function itemColor(it: CalItem): string {
  if (it.source === 'event') return 'var(--violet-bright, #a78bfa)';
  if (it.live) return 'var(--coral-bright)';
  return 'var(--cyan-bright)';
}

/**
 * Shared meetings calendar — month overview + bookable week grid, with the current
 * user's availability windows shaded and connected-calendar events overlaid. Click
 * an open slot (week) or a day (month) to book; click a meeting to join. Self-contained:
 * drives its own booking modal, availability editor, and join overlay, so it drops
 * into any surface (Workforce tab, Portfolio panel) unchanged.
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
  const locale = useLocale();
  const { user } = useAuth();

  const [view, setView] = useState<'month' | 'week'>(defaultView);
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
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
  useEffect(() => { reload(); }, [reload]);

  // Unify meetings + calendar events into positioned items.
  const items = useMemo<CalItem[]>(() => {
    const out: CalItem[] = [];
    for (const d of meetings) {
      const m = d.meeting;
      if (m.status === 'cancelled') continue;
      const start = m.scheduledAt ? new Date(m.scheduledAt).getTime() : (m.startedAt ? new Date(m.startedAt).getTime() : null);
      if (start == null) continue;
      out.push({
        id: `m:${m.id}`, title: m.title, startMs: start, endMs: start + m.durationMinutes * 60_000,
        source: 'meeting', kind: m.kind, live: m.status === 'live',
        joinable: m.status === 'live' || m.status === 'scheduled', meetingId: m.id,
      });
    }
    for (const e of events) {
      const s = Date.parse(e.startISO); const en = Date.parse(e.endISO);
      if (!Number.isFinite(s)) continue;
      out.push({ id: `e:${e.provider}:${e.id}`, title: e.title, startMs: s, endMs: Number.isFinite(en) ? en : s + 30 * 60_000, source: 'event', href: e.htmlLink });
    }
    return out.sort((a, b) => a.startMs - b.startMs);
  }, [meetings, events]);

  const dayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: compact ? 'narrow' : 'short' }), [locale, compact]);
  const monthTitleFmt = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }), [locale]);
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }), [locale]);

  const step = view === 'month' ? 'month' : 'week';
  const shift = (dir: number) => setAnchor((prev) => {
    const x = new Date(prev);
    if (step === 'month') x.setMonth(x.getMonth() + dir); else x.setDate(x.getDate() + dir * 7);
    return startOfDay(x);
  });

  const openBook = (at: Date | null) => { setBookAt(at ? at.toISOString() : null); setBookOpen(true); };

  const headerTitle = view === 'month'
    ? monthTitleFmt.format(anchor)
    : (() => {
        const ws = startOfWeek(anchor); const we = addDays(ws, 6);
        return `${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(ws)} – ${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(we)}`;
      })();

  // Availability lookup: is (day,minutes) inside a declared window? (local browser time)
  const availByDay = useMemo(() => {
    const map = new Map<number, Array<{ start: number; end: number }>>();
    for (const w of availability?.windows ?? []) {
      const list = map.get(w.day) ?? []; list.push({ start: w.start, end: w.end }); map.set(w.day, list);
    }
    return map;
  }, [availability]);
  const isAvailable = useCallback((day: number, minutes: number) =>
    (availByDay.get(day) ?? []).some((w) => minutes >= w.start && minutes < w.end), [availByDay]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => shift(-1)} aria-label={t('prev')} style={navBtn}>‹</button>
          <button type="button" onClick={() => setAnchor(startOfDay(new Date()))} style={{ ...navBtn, width: 'auto', padding: '0 12px', fontSize: 12, fontWeight: 600 }}>{t('today')}</button>
          <button type="button" onClick={() => shift(1)} aria-label={t('next')} style={navBtn}>›</button>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginLeft: 6 }}>{headerTitle}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <ViewToggle value={view} onChange={(v) => setView(v as 'month' | 'week')} options={[{ value: 'week', label: t('calWeek') }, { value: 'month', label: t('calMonth') }]} />
          <button type="button" onClick={() => setAvailOpen(true)} style={ghostBtn}>{t('myAvailability')}</button>
          <button type="button" onClick={() => openBook(null)} style={primaryBtn}>{t('newMeeting')}</button>
        </div>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 16 }}>{t('loading')}</div>
      ) : view === 'month' ? (
        <MonthGrid anchor={anchor} items={items} dayFmt={dayFmt} locale={locale}
          onPickDay={(d) => openBook(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0))}
          onJoin={setActiveMeetingId} />
      ) : (
        <WeekGrid anchor={anchor} items={items} dayFmt={dayFmt} timeFmt={timeFmt}
          isAvailable={isAvailable}
          onPickSlot={openBook} onJoin={setActiveMeetingId} availableLabel={t('available')} />
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
        <Legend color="var(--cyan-bright)" label={t('legendScheduled')} />
        <Legend color="var(--coral-bright)" label={t('legendLive')} />
        <Legend color="var(--violet-bright, #a78bfa)" label={t('legendCalendar')} />
        <Legend color="var(--success-bg, rgba(52,211,153,0.18))" label={t('legendAvailable')} border />
      </div>

      <ScheduleMeetingPanel
        open={bookOpen}
        onClose={() => setBookOpen(false)}
        onCreated={(detail, joinNow) => { setMeetings((prev) => [detail, ...prev]); if (joinNow) setActiveMeetingId(detail.meeting.id); reload(); }}
        presetAt={bookAt}
        projectId={projectId}
      />
      {availOpen && (
        <AvailabilityEditor initial={availability} onClose={() => setAvailOpen(false)} onSaved={(a) => { setAvailability(a); setAvailOpen(false); }} />
      )}
      {activeMeetingId && (
        <MeetingRoom meetingId={activeMeetingId} onClose={() => { setActiveMeetingId(null); reload(); }} />
      )}
    </div>
  );
}

function Legend({ color, label, border }: { color: string; label: string; border?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color, border: border ? '1px solid var(--success-border, #34d399)' : 'none' }} />
      {label}
    </span>
  );
}

// ── Month grid ────────────────────────────────────────────────────────────────
function MonthGrid({ anchor, items, dayFmt, locale, onPickDay, onJoin }: {
  anchor: Date; items: CalItem[]; dayFmt: Intl.DateTimeFormat; locale: string;
  onPickDay: (d: Date) => void; onJoin: (id: string) => void;
}) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 560 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'center', textTransform: 'uppercase' }}>
              {weekdayFmt.format(addDays(gridStart, i))}
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {cells.map((d, i) => {
            const inMonth = d.getMonth() === anchor.getMonth();
            const isToday = sameDay(Date.now(), d);
            const dayItems = items.filter((it) => sameDay(it.startMs, d));
            return (
              <div key={i} onClick={() => onPickDay(d)}
                style={{ minHeight: 84, padding: 6, borderRadius: 8, cursor: 'pointer', background: inMonth ? 'var(--surface-card)' : 'var(--bg-deep)', border: `1px solid ${isToday ? 'var(--coral-bright)' : 'var(--border-subtle)'}`, opacity: inMonth ? 1 : 0.55, display: 'flex', flexDirection: 'column', gap: 3, overflow: 'hidden' }}>
                <span style={{ fontSize: 12, fontWeight: isToday ? 800 : 600, color: 'var(--text-primary)' }}>{d.getDate()}</span>
                {dayItems.slice(0, 3).map((it) => (
                  <button key={it.id} type="button"
                    onClick={(ev) => { ev.stopPropagation(); if (it.meetingId) onJoin(it.meetingId); else if (it.href) window.open(it.href, '_blank'); }}
                    title={it.title}
                    style={{ textAlign: 'left', fontSize: 10, padding: '1px 4px', borderRadius: 4, background: itemColor(it), color: 'var(--bg-deep)', border: 'none', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.title}
                  </button>
                ))}
                {dayItems.length > 3 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>+{dayItems.length - 3}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Week grid ─────────────────────────────────────────────────────────────────
function WeekGrid({ anchor, items, dayFmt, timeFmt, isAvailable, onPickSlot, onJoin, availableLabel }: {
  anchor: Date; items: CalItem[]; dayFmt: Intl.DateTimeFormat; timeFmt: Intl.DateTimeFormat;
  isAvailable: (day: number, minutes: number) => boolean;
  onPickSlot: (at: Date) => void; onJoin: (id: string) => void; availableLabel: string;
}) {
  const weekStart = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const rows: number[] = [];
  for (let h = HOUR_START; h < HOUR_END; h++) for (let m = 0; m < 60; m += SLOT_MIN) rows.push(h * 60 + m);
  const rowH = 26;

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 640 }}>
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(7, 1fr)', gap: 2, position: 'sticky', top: 0 }}>
          <div />
          {days.map((d, i) => {
            const isToday = sameDay(Date.now(), d);
            return (
              <div key={i} style={{ textAlign: 'center', padding: '4px 0', fontSize: 12, fontWeight: 700, color: isToday ? 'var(--coral-bright)' : 'var(--text-secondary)' }}>
                {dayFmt.format(d)} {d.getDate()}
              </div>
            );
          })}
        </div>
        {/* Time grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(7, 1fr)', gap: 2, position: 'relative' }}>
          {/* Hour labels + slot cells */}
          {rows.map((mins) => (
            <FragmentRow key={mins}>
              <div style={{ height: rowH, fontSize: 10, color: 'var(--text-muted)', textAlign: 'right', paddingRight: 6, transform: 'translateY(-6px)' }}>
                {mins % 60 === 0 ? timeFmt.format(new Date(2020, 0, 1, Math.floor(mins / 60), 0)) : ''}
              </div>
              {days.map((d, di) => {
                const slotStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(mins / 60), mins % 60);
                const avail = isAvailable(d.getDay(), mins);
                return (
                  <div key={di}
                    onClick={() => onPickSlot(slotStart)}
                    title={avail ? availableLabel : undefined}
                    style={{ height: rowH, cursor: 'pointer', borderTop: '1px solid var(--border-subtle)', background: avail ? 'var(--success-bg, rgba(52,211,153,0.14))' : 'transparent' }}
                  />
                );
              })}
            </FragmentRow>
          ))}
          {/* Positioned event blocks (absolute over the grid) */}
          {days.map((d, di) => {
            const dayItems = items.filter((it) => sameDay(it.startMs, d));
            return dayItems.map((it) => {
              const s = new Date(it.startMs); const startMin = s.getHours() * 60 + s.getMinutes();
              if (startMin < HOUR_START * 60 || startMin >= HOUR_END * 60) return null;
              const top = ((startMin - HOUR_START * 60) / SLOT_MIN) * (rowH + 2);
              const durMin = Math.max(SLOT_MIN, (it.endMs - it.startMs) / 60_000);
              const height = Math.max(rowH - 2, (durMin / SLOT_MIN) * (rowH + 2) - 2);
              const colWidth = `calc((100% - 52px - 14px) / 7)`;
              const left = `calc(52px + 2px + ${di} * (${colWidth} + 2px))`;
              return (
                <button key={it.id} type="button"
                  onClick={() => { if (it.meetingId) onJoin(it.meetingId); else if (it.href) window.open(it.href, '_blank'); }}
                  title={it.title}
                  style={{ position: 'absolute', top, left, width: colWidth, height, background: itemColor(it), color: 'var(--bg-deep)', border: 'none', borderRadius: 5, padding: '2px 5px', fontSize: 10, fontWeight: 600, textAlign: 'left', cursor: 'pointer', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }}>
                  {timeFmt.format(s)} · {it.title}
                </button>
              );
            });
          })}
        </div>
      </div>
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }

const navBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: 'pointer', background: 'var(--bg-deep)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' };
const ghostBtn: React.CSSProperties = { padding: '7px 12px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', background: 'var(--bg-deep)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' };
const primaryBtn: React.CSSProperties = { padding: '7px 14px', fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: 'pointer', background: 'var(--coral-bright)', color: 'var(--bg-deep)', border: 'none' };
