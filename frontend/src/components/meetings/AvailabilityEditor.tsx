'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Select } from '@/components/Select';
import { meetingsApi, type AvailabilityProfile, type AvailabilityWindow } from '@/lib/builderforceApi';

function browserTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}
function tzList(): string[] {
  try {
    const withValues = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    if (withValues.supportedValuesOf) return withValues.supportedValuesOf('timeZone');
  } catch { /* fall through */ }
  return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Europe/Madrid', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Kolkata', 'Australia/Sydney'];
}
const minToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const hhmmToMin = (s: string) => { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/**
 * Editor for the current user's weekly bookable availability (working hours) +
 * timezone. Windows feed the calendar's shading and the "find a time" solver so
 * teammates only book inside declared hours.
 */
export function AvailabilityEditor({
  initial, onClose, onSaved,
}: {
  initial: AvailabilityProfile | null;
  onClose: () => void;
  onSaved: (profile: AvailabilityProfile) => void;
}) {
  const t = useTranslations('meetings');
  const locale = useLocale();
  const [timezone, setTimezone] = useState(initial?.timezone && initial.timezone !== 'UTC' ? initial.timezone : browserTz());
  const [windows, setWindows] = useState<AvailabilityWindow[]>(initial?.windows ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zones = useMemo(() => {
    const list = tzList();
    return list.includes(timezone) ? list : [timezone, ...list];
  }, [timezone]);
  const dayName = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'long' });
    // 2024-01-07 is a Sunday → index 0..6 = Sun..Sat.
    return (day: number) => fmt.format(new Date(2024, 0, 7 + day));
  }, [locale]);

  const byDay = useMemo(() => {
    const m = new Map<number, AvailabilityWindow[]>();
    for (let d = 0; d < 7; d++) m.set(d, []);
    for (const w of windows) m.get(w.day)?.push(w);
    for (const list of m.values()) list.sort((a, b) => a.start - b.start);
    return m;
  }, [windows]);

  const addWindow = useCallback((day: number) => {
    setWindows((prev) => [...prev, { day, start: 9 * 60, end: 17 * 60 }]);
  }, []);
  const updateWindow = useCallback((day: number, idx: number, patch: Partial<AvailabilityWindow>) => {
    setWindows((prev) => {
      const dayWins = prev.filter((w) => w.day === day);
      const target = dayWins[idx];
      if (!target) return prev;
      return prev.map((w) => (w === target ? { ...w, ...patch } : w));
    });
  }, []);
  const removeWindow = useCallback((day: number, idx: number) => {
    setWindows((prev) => {
      const dayWins = prev.filter((w) => w.day === day);
      const target = dayWins[idx];
      return prev.filter((w) => w !== target);
    });
  }, []);

  const applyWeekdayDefault = useCallback(() => {
    setWindows((prev) => {
      const kept = prev.filter((w) => w.day === 0 || w.day === 6); // keep any weekend windows
      const weekdays: AvailabilityWindow[] = [1, 2, 3, 4, 5].map((day) => ({ day, start: 9 * 60, end: 17 * 60 }));
      return [...kept, ...weekdays];
    });
  }, []);

  const save = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      // Drop invalid windows (end must be after start).
      const clean = windows.filter((w) => w.end > w.start);
      const saved = await meetingsApi.setMyAvailability({ timezone, windows: clean });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally { setBusy(false); }
  }, [windows, timezone, onSaved]);

  const field: React.CSSProperties = { fontSize: 13, padding: '6px 8px', borderRadius: 6, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' };

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ marginTop: '4vh', width: '100%', maxWidth: 560, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{t('availabilityTitle')}</h2>
          <button type="button" onClick={applyWeekdayDefault} style={{ fontSize: 12, fontWeight: 600, color: 'var(--coral-bright)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('weekdayDefault')}</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{t('availabilitySubtitle')}</p>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('timezone')}</span>
          <Select value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ ...field, width: '100%' }}>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </Select>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 7 }, (_, day) => {
            const wins = byDay.get(day) ?? [];
            return (
              <div key={day} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderTop: '1px solid var(--border-subtle)' }}>
                <span style={{ width: 96, flexShrink: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', paddingTop: 6 }}>{dayName(day)}</span>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {wins.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)', paddingTop: 6 }}>{t('unavailable')}</span>}
                  {wins.map((w, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="time" value={minToHHMM(w.start)} onChange={(e) => updateWindow(day, idx, { start: hhmmToMin(e.target.value) })} style={field} />
                      <span style={{ color: 'var(--text-muted)' }}>–</span>
                      <input type="time" value={minToHHMM(w.end)} onChange={(e) => updateWindow(day, idx, { end: hhmmToMin(e.target.value) })} style={field} />
                      <button type="button" onClick={() => removeWindow(day, idx)} aria-label={t('remove')} style={{ background: 'none', border: 'none', color: 'var(--error-text)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => addWindow(day)} style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: 'var(--coral-bright)', background: 'none', border: 'none', cursor: 'pointer', paddingTop: 6 }}>+ {t('addWindow')}</button>
              </div>
            );
          })}
        </div>

        {error && <div style={{ fontSize: 13, color: 'var(--error-text)' }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer', background: 'var(--bg-deep)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>{t('cancel')}</button>
          <button type="button" onClick={save} disabled={busy} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: 'pointer', background: 'var(--coral-bright)', color: 'var(--bg-deep)', border: 'none', opacity: busy ? 0.6 : 1 }}>{t('save')}</button>
        </div>
      </div>
    </div>
  );
}
