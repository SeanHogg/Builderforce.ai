'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { Select } from '@/components/Select';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { listWorkforceDirectory, type WorkforceOption } from '@/lib/teams';
import { meetingsApi, type MeetingDetail, type MeetingKind, type TimeSlot } from '@/lib/builderforceApi';

const KINDS: MeetingKind[] = ['standup', 'planning', 'retrospective', 'adhoc', 'direct', 'interview', 'review'];

/** ISO (UTC) → the local "YYYY-MM-DDTHH:MM" a datetime-local input expects. */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Schedule a new meeting — or start one immediately. Pick a kind, an optional
 * time (blank = start now), duration, attendees, and whether cameras are enabled.
 * "Find a time" proposes slots where every invitee is free and within their
 * declared availability. A scheduled meeting mirrors to the organizer's calendar.
 *
 * Rendered as a slide-out side panel (not a modal): per the app convention, modals
 * are reserved for terminal / destructive approvals — every other overlay is a
 * SlideOutPanel, which behaves better on mobile and adaptive layouts.
 */
export function ScheduleMeetingPanel({
  open, onClose, onCreated, startNow = false, presetAt = null, projectId = null,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (detail: MeetingDetail, joinNow: boolean) => void;
  /** Preset the panel for an instant ad-hoc call. */
  startNow?: boolean;
  /** ISO start time to prefill (from clicking a calendar slot). */
  presetAt?: string | null;
  /** Bind the meeting to a project (scopes join authorization to project members). */
  projectId?: number | null;
}) {
  const t = useTranslations('meetings');
  const { user } = useAuth();
  const [kind, setKind] = useState<MeetingKind>('adhoc');
  const [title, setTitle] = useState('');
  const [scheduled, setScheduled] = useState(!startNow);
  const [scheduledAt, setScheduledAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [directory, setDirectory] = useState<WorkforceOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<TimeSlot[] | null>(null);
  const [finding, setFinding] = useState(false);

  useEffect(() => {
    if (!open) return;
    setScheduled(!startNow || !!presetAt);
    setScheduledAt(presetAt ? isoToLocalInput(presetAt) : '');
    setSlots(null);
    setError(null);
    listWorkforceDirectory().then(setDirectory).catch(() => setDirectory([]));
  }, [open, startNow, presetAt]);

  const others = useMemo(() => directory.filter((o) => o.ref !== user?.id), [directory, user?.id]);

  const toggle = useCallback((ref: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref); else next.add(ref);
      return next;
    });
    setSlots(null);
  }, []);

  // Human attendee refs (agents have no availability) + me → the find-a-time input set.
  const humanRefs = useMemo(() => {
    const refs = others.filter((o) => selected.has(o.ref) && o.kind === 'human').map((o) => o.ref);
    if (user?.id) refs.unshift(user.id);
    return refs;
  }, [others, selected, user?.id]);

  const findTimes = useCallback(async () => {
    setFinding(true); setError(null);
    try {
      const from = new Date();
      const to = new Date(from.getTime() + 14 * 86_400_000);
      const { slots: found } = await meetingsApi.suggest(humanRefs, durationMinutes, from.toISOString(), to.toISOString(), 6);
      setSlots(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not find a time');
    } finally { setFinding(false); }
  }, [humanRefs, durationMinutes]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const attendees = others.filter((o) => selected.has(o.ref)).map((o) => ({ kind: o.kind, ref: o.ref, name: o.name }));
      const detail = await meetingsApi.create({
        kind,
        title: title.trim() || undefined,
        projectId,
        scheduledAt: scheduled && scheduledAt ? new Date(scheduledAt).toISOString() : null,
        durationMinutes,
        videoEnabled: kind === 'direct' ? false : videoEnabled,
        attendees,
        organizerName: user?.name ?? user?.email ?? undefined,
        organizerEmail: user?.email ?? undefined,
      });
      onCreated(detail, !scheduled || !scheduledAt);
      onClose();
      setTitle(''); setScheduledAt(''); setSelected(new Set()); setKind('adhoc'); setSlots(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create meeting');
    } finally { setBusy(false); }
  }, [others, selected, kind, title, projectId, scheduled, scheduledAt, durationMinutes, videoEnabled, user, onCreated, onClose]);

  const field: React.CSSProperties = { fontSize: 13, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', width: '100%' };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6, display: 'block' };
  const slotFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <SlideOutPanel open={open} onClose={onClose} title={startNow && !presetAt ? t('startNowTitle') : t('scheduleTitle')}>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={label}>{t('kind')}</label>
          <Select value={kind} onChange={(e) => setKind(e.target.value as MeetingKind)} style={field}>
            {KINDS.map((k) => <option key={k} value={k}>{t(`kind_${k}`)}</option>)}
          </Select>
        </div>

        <div>
          <label style={label}>{t('titleLabel')}</label>
          <input style={field} value={title} placeholder={t(`kind_${kind}`)} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={scheduled} onChange={(e) => setScheduled(e.target.checked)} />
            {t('scheduleForLater')}
          </label>
          {kind !== 'direct' && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={videoEnabled} onChange={(e) => setVideoEnabled(e.target.checked)} />
              {t('camerasEnabled')}
            </label>
          )}
        </div>

        {scheduled && (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 180px' }}>
                <label style={label}>{t('startTime')}</label>
                <input type="datetime-local" style={field} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              </div>
              <div style={{ flex: '0 1 140px' }}>
                <label style={label}>{t('duration')}</label>
                <Select value={String(durationMinutes)} onChange={(e) => { setDurationMinutes(Number(e.target.value)); setSlots(null); }} style={field}>
                  {[15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{t('minutes', { count: d })}</option>)}
                </Select>
              </div>
            </div>

            {/* Find a time — proposes slots everyone is free + available for. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" onClick={findTimes} disabled={finding}
                style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 700, color: 'var(--coral-bright)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, opacity: finding ? 0.6 : 1 }}>
                {finding ? t('finding') : `✨ ${t('findATime')}`}
              </button>
              {slots && (
                slots.length === 0 ? (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noSlots')}</span>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {slots.map((s) => (
                      <button key={s.startISO} type="button" onClick={() => { setScheduledAt(isoToLocalInput(s.startISO)); setSlots(null); }}
                        style={{ fontSize: 12, padding: '5px 10px', borderRadius: 999, cursor: 'pointer', background: 'var(--bg-deep)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}>
                        {slotFmt.format(new Date(s.startISO))}
                      </button>
                    ))}
                  </div>
                )
              )}
            </div>
          </>
        )}

        <div>
          <label style={label}>{t('invite')}</label>
          <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {others.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: 6 }}>{t('noTeammates')}</span>
            ) : others.map((o) => (
              <label key={`${o.kind}:${o.ref}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={selected.has(o.ref)} onChange={() => toggle(o.ref)} />
                <span>{o.name}</span>
                {o.kind !== 'human' && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {t('agent')}</span>}
              </label>
            ))}
          </div>
        </div>

        {error && <div style={{ fontSize: 13, color: 'var(--error-text)' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', background: 'var(--bg-deep)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
            {t('cancel')}
          </button>
          <button type="button" onClick={submit} disabled={busy} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: 'pointer', background: 'var(--coral-bright)', color: 'var(--bg-deep)', border: 'none', opacity: busy ? 0.6 : 1 }}>
            {scheduled ? t('schedule') : t('startNow')}
          </button>
        </div>
      </div>
    </SlideOutPanel>
  );
}
