'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { Select } from '@/components/Select';
import { listWorkforceDirectory, type WorkforceOption } from '@/lib/teams';
import { meetingsApi, type MeetingDetail, type MeetingKind } from '@/lib/builderforceApi';

const KINDS: MeetingKind[] = ['standup', 'planning', 'retrospective', 'adhoc', 'direct'];

/**
 * Schedule a new meeting — or start one immediately. Pick a kind, an optional
 * time (blank = start now), duration, attendees, and whether cameras are enabled.
 * A scheduled meeting with a connected calendar is mirrored as a calendar event.
 */
export function ScheduleMeetingModal({
  open, onClose, onCreated, startNow = false,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (detail: MeetingDetail, joinNow: boolean) => void;
  /** Preset the modal for an instant ad-hoc call. */
  startNow?: boolean;
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

  useEffect(() => {
    if (!open) return;
    setScheduled(!startNow);
    setError(null);
    listWorkforceDirectory().then(setDirectory).catch(() => setDirectory([]));
  }, [open, startNow]);

  const others = useMemo(() => directory.filter((o) => o.ref !== user?.id), [directory, user?.id]);

  const toggle = useCallback((ref: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref); else next.add(ref);
      return next;
    });
  }, []);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const attendees = others.filter((o) => selected.has(o.ref)).map((o) => ({ kind: o.kind, ref: o.ref, name: o.name }));
      const detail = await meetingsApi.create({
        kind,
        title: title.trim() || undefined,
        scheduledAt: scheduled && scheduledAt ? new Date(scheduledAt).toISOString() : null,
        durationMinutes,
        videoEnabled: kind === 'direct' ? false : videoEnabled,
        attendees,
        organizerName: user?.name ?? user?.email ?? undefined,
        organizerEmail: user?.email ?? undefined,
      });
      onCreated(detail, !scheduled || !scheduledAt);
      onClose();
      // reset
      setTitle(''); setScheduledAt(''); setSelected(new Set()); setKind('adhoc');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create meeting');
    } finally { setBusy(false); }
  }, [others, selected, kind, title, scheduled, scheduledAt, durationMinutes, videoEnabled, user, onCreated, onClose]);

  if (!open) return null;

  const field: React.CSSProperties = { fontSize: 13, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', width: '100%' };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6, display: 'block' };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflow: 'auto' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ marginTop: '5vh', width: '100%', maxWidth: 480, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {startNow ? t('startNowTitle') : t('scheduleTitle')}
        </h2>

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
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px' }}>
              <label style={label}>{t('startTime')}</label>
              <input type="datetime-local" style={field} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </div>
            <div style={{ flex: '0 1 140px' }}>
              <label style={label}>{t('duration')}</label>
              <Select value={String(durationMinutes)} onChange={(e) => setDurationMinutes(Number(e.target.value))} style={field}>
                {[15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{t('minutes', { count: d })}</option>)}
              </Select>
            </div>
          </div>
        )}

        <div>
          <label style={label}>{t('invite')}</label>
          <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
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
    </div>
  );
}
