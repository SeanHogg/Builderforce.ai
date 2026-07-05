'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  meetingsApi, calendarApi,
  type MeetingDetail, type CalendarEventItem,
} from '@/lib/builderforceApi';
import { CalendarConnectionsCard } from './CalendarConnectionsCard';
import { ScheduleMeetingModal } from './ScheduleMeetingModal';
import { MeetingRoom } from './MeetingRoom';

function KindBadge({ label }: { label: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, padding: '2px 8px', borderRadius: 999, background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
      {label}
    </span>
  );
}

/**
 * Meetings — schedule, connect calendars, and join live video/audio sessions
 * (standups, planning, retros, ad-hoc or direct calls). Handles the calendar
 * OAuth return + the `?join=<id>` deep link from a calendar invite.
 */
export default function MeetingsContent() {
  const t = useTranslations('meetings');
  const router = useRouter();
  const params = useSearchParams();

  const [meetings, setMeetings] = useState<MeetingDetail[]>([]);
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [startNowPreset, setStartNowPreset] = useState(false);
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [m, e] = await Promise.all([
        meetingsApi.list({ scope: 'upcoming' }),
        calendarApi.events(14).catch(() => ({ events: [] as CalendarEventItem[] })),
      ]);
      setMeetings(m.meetings);
      setEvents(e.events);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // Handle the calendar OAuth return + a ?join=<id> deep link, then clean the URL.
  useEffect(() => {
    const cal = params.get('calendar');
    const join = params.get('join');
    if (cal) {
      setToast(cal === 'connected' ? t('calendarConnected') : t('calendarConnectFailed'));
      if (cal === 'connected') reload();
    }
    if (join) setActiveMeetingId(join);
    if (cal || join) router.replace('/meetings');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const onCreated = useCallback((detail: MeetingDetail, joinNow: boolean) => {
    setMeetings((prev) => [detail, ...prev.filter((m) => m.meeting.id !== detail.meeting.id)]);
    if (joinNow) setActiveMeetingId(detail.meeting.id);
  }, []);

  const openSchedule = (startNow: boolean) => { setStartNowPreset(startNow); setScheduleOpen(true); };

  const live = useMemo(() => meetings.filter((m) => m.meeting.status === 'live'), [meetings]);
  const upcoming = useMemo(() => meetings.filter((m) => m.meeting.status === 'scheduled'), [meetings]);

  function whenLabel(iso: string | null): string {
    if (!iso) return t('anytime');
    try { return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch { return iso; }
  }

  const btn = (primary = false): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: 'pointer',
    background: primary ? 'var(--coral-bright)' : 'var(--bg-deep)',
    color: primary ? 'var(--bg-deep)' : 'var(--text-secondary)',
    border: `1px solid ${primary ? 'var(--coral-bright)' : 'var(--border-subtle)'}`,
  });

  function MeetingCard({ detail, isLive }: { detail: MeetingDetail; isLive: boolean }) {
    const m = detail.meeting;
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--surface-card)', border: `1px solid ${isLive ? 'var(--coral-bright)' : 'var(--border-subtle)'}`, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{m.title}</span>
            <KindBadge label={t(`kind_${m.kind}`)} />
            {isLive && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--coral-bright)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--coral-bright)' }} />{t('liveNow')}</span>}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {whenLabel(m.scheduledAt)} · {t('attendeeCount', { count: detail.attendees.length })}
          </span>
        </div>
        <button type="button" onClick={() => setActiveMeetingId(m.id)} style={btn(true)}>
          {isLive ? t('join') : t('joinEarly')}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1000, margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>{t('title')}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>{t('subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => openSchedule(true)} style={btn(true)}>{t('startNow')}</button>
          <button type="button" onClick={() => openSchedule(false)} style={btn(false)}>{t('schedule')}</button>
        </div>
      </div>

      {toast && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: 13 }}>{toast}</div>
      )}

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: meetings + calendar events */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0, flex: '1 1 420px' }}>
          <section>
            <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', margin: '0 0 10px' }}>{t('liveAndUpcoming')}</h2>
            {loading ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
            ) : live.length === 0 && upcoming.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px', background: 'var(--surface-card)', border: '1px dashed var(--border-subtle)', borderRadius: 12 }}>{t('noMeetings')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {live.map((d) => <MeetingCard key={d.meeting.id} detail={d} isLive />)}
                {upcoming.map((d) => <MeetingCard key={d.meeting.id} detail={d} isLive={false} />)}
              </div>
            )}
          </section>

          {events.length > 0 && (
            <section>
              <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', margin: '0 0 10px' }}>{t('fromYourCalendar')}</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {events.map((e) => (
                  <a
                    key={`${e.provider}:${e.id}`}
                    href={e.htmlLink}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderRadius: 10, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', textDecoration: 'none', flexWrap: 'wrap' }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{e.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{whenLabel(e.startISO)}</div>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{e.provider}</span>
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right: calendar connections */}
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <CalendarConnectionsCard />
        </div>
      </div>

      <ScheduleMeetingModal open={scheduleOpen} startNow={startNowPreset} onClose={() => setScheduleOpen(false)} onCreated={onCreated} />
      {activeMeetingId && (
        <MeetingRoom meetingId={activeMeetingId} onClose={() => { setActiveMeetingId(null); reload(); }} />
      )}
    </div>
  );
}
