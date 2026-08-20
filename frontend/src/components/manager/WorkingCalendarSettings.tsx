'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { RoleGate } from '@/components/RoleGate';
import { useConfirm } from '@/components/ConfirmProvider';
import { pmoApi, type Holiday, type WorkingCalendarSettings as Settings } from '@/lib/builderforceApi';

/**
 * The workspace's WORKING CALENDAR — which weekdays this workspace works, and the
 * days nobody does.
 *
 * The scheduler used to answer "is this a working day?" with a hardcoded Monday-to-
 * Friday test, which is wrong for any workspace that does not run a Western week
 * and wrong for EVERY workspace across a public holiday: plans were drawn over days
 * nobody was going to work, and the first person to find out was whoever missed the
 * date. This is where a workspace states the truth instead.
 *
 * Workspace-wide, not per project — a person's weekend does not change per board —
 * so it says so, even though it is reached from the project's manager surface (the
 * one place a PM already goes to ask why the dates look wrong). Editing is
 * manager-gated; reading is open, because everyone's dates depend on it.
 */

/** Sunday-first, matching `Date.getUTCDay()` — the numbers the API stores. */
const WEEKDAY_NUMBERS = [0, 1, 2, 3, 4, 5, 6] as const;

export function WorkingCalendarSettings() {
  const t = useTranslations('workingCalendar');
  const confirm = useConfirm();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newHoliday, setNewHoliday] = useState<Holiday>({ date: '', name: '' });

  const load = useCallback(async () => {
    setError(null);
    try {
      setSettings(await pmoApi.workingCalendar());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const persist = async (next: Settings) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const written = await pmoApi.saveWorkingCalendar({
        workingWeekdays: next.workingWeekdays,
        holidays: next.holidays,
        timezone: next.timezone,
      });
      setSettings(written);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleWeekday = async (day: number) => {
    if (!settings) return;
    const on = settings.workingWeekdays.includes(day);
    const next = on
      ? settings.workingWeekdays.filter((d) => d !== day)
      : [...settings.workingWeekdays, day].sort((a, b) => a - b);
    // An empty working week is not a calendar — every plan would have nowhere to
    // land — and the server would reject it back to the default anyway. Refuse it
    // here so the user sees WHY rather than watching their change silently revert.
    if (next.length === 0) { setError(t('errorEmptyWeek')); return; }
    await persist({ ...settings, workingWeekdays: next });
  };

  const addHoliday = async () => {
    if (!settings || !newHoliday.date) return;
    const next = [...settings.holidays.filter((h) => h.date !== newHoliday.date), { ...newHoliday }]
      .sort((a, b) => a.date.localeCompare(b.date));
    await persist({ ...settings, holidays: next });
    setNewHoliday({ date: '', name: '' });
  };

  const removeHoliday = async (date: string) => {
    if (!settings) return;
    // Removing a closed day moves real dates back onto it, so it is confirmed.
    if (!(await confirm({ message: t('confirmRemoveHoliday', { date }), destructive: true }))) return;
    await persist({ ...settings, holidays: settings.holidays.filter((h) => h.date !== date) });
  };

  if (error && !settings) {
    return <div role="alert" style={{ ...panelStyle, ...toneDanger }}>{error}</div>;
  }
  if (!settings) return <div style={panelStyle}><span style={mutedStyle}>{t('loading')}</span></div>;

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>{t('title')}</strong>
        <span style={mutedStyle}>{t('scopeNote')}</span>
        {!settings.configured && (
          <span style={{ ...mutedStyle, marginLeft: 'auto' }}>{t('usingDefault')}</span>
        )}
      </div>
      <p style={{ ...mutedStyle, marginTop: 6, marginBottom: 14, lineHeight: 1.5 }}>{t('caption')}</p>

      {error && <div role="alert" style={{ ...noticeStyle, ...toneDanger }}>{error}</div>}
      {saved && <div role="status" style={{ ...noticeStyle, ...toneSuccess }}>{t('saved')}</div>}

      <RoleGate capability="manager.manage" variant="block">
        <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }} disabled={busy}>
          <legend style={labelStyle}>{t('workingWeek')}</legend>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
            {WEEKDAY_NUMBERS.map((day) => {
              const on = settings.workingWeekdays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() => void toggleWeekday(day)}
                  disabled={busy}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: busy ? 'default' : 'pointer',
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--border-subtle)'}`,
                    background: on ? 'var(--accent)' : 'transparent',
                    color: on ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                  }}
                >
                  {t(`weekday.${day}`)}
                </button>
              );
            })}
          </div>

          <div style={labelStyle}>{t('holidays')}</div>
          {settings.holidays.length === 0 && (
            <div style={{ ...mutedStyle, marginBottom: 10 }}>{t('noHolidays')}</div>
          )}
          <ul style={{ listStyle: 'none', margin: '0 0 10px', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {settings.holidays.map((h) => (
              <li
                key={h.date}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '6px 10px',
                }}
              >
                <code style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>{h.date}</code>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', minWidth: 0, wordBreak: 'break-word' }}>
                  {h.name || t('unnamedHoliday')}
                </span>
                <button
                  type="button"
                  onClick={() => void removeHoliday(h.date)}
                  disabled={busy}
                  style={{ ...ghostBtnStyle, marginLeft: 'auto', color: 'var(--error-text)' }}
                >
                  {t('remove')}
                </button>
              </li>
            ))}
          </ul>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="date"
              aria-label={t('holidayDate')}
              value={newHoliday.date}
              onChange={(e) => setNewHoliday((h) => ({ ...h, date: e.target.value }))}
              style={{ ...controlStyle, minWidth: 150, colorScheme: 'light dark' }}
            />
            <input
              type="text"
              aria-label={t('holidayName')}
              placeholder={t('holidayNamePlaceholder')}
              value={newHoliday.name}
              onChange={(e) => setNewHoliday((h) => ({ ...h, name: e.target.value }))}
              style={{ ...controlStyle, flex: 1, minWidth: 160 }}
            />
            <button
              type="button"
              onClick={() => void addHoliday()}
              disabled={busy || !newHoliday.date}
              style={{ ...ghostBtnStyle, opacity: newHoliday.date ? 1 : 0.55 }}
            >
              <Icon source="＋" size="1em" /> {t('addHoliday')}
            </button>
          </div>
        </fieldset>
      </RoleGate>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
  minWidth: 0,
};
const mutedStyle: React.CSSProperties = { color: 'var(--text-muted)', fontSize: '0.8rem' };
const labelStyle: React.CSSProperties = {
  fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
  color: 'var(--text-muted)', marginBottom: 8, padding: 0,
};
const controlStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.85rem', maxWidth: '100%',
};
const ghostBtnStyle: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'transparent', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.8rem',
  cursor: 'pointer', whiteSpace: 'nowrap',
};
const noticeStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-md)', padding: '8px 10px', fontSize: '0.82rem', marginBottom: 12,
};
const toneDanger: React.CSSProperties = { background: 'var(--danger-bg)', color: 'var(--danger-text)' };
const toneSuccess: React.CSSProperties = { background: 'var(--success-bg)', color: 'var(--success-text)' };
