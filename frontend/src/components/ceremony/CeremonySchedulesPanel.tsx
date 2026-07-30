'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { useConfirm } from '@/components/ConfirmProvider';
import { RoleGate } from '@/components/RoleGate';
import { usePermission } from '@/lib/rbac';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import {
  tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle,
} from '@/components/dataTableStyles';
import {
  ceremonySchedulesApi, type CeremonySchedule, type CeremonyScheduleInput,
} from '@/lib/builderforceApi';

/**
 * Ceremony cadence management — the UI for `ceremony_schedules` (migration 0349).
 *
 * A schedule makes a standup / planning run itself: the frequent cron sweep opens
 * a session with its roster pre-seeded for every due row, then re-arms next_run_at
 * from the cron. Cadence is a 5-field cron + IANA timezone (the same language QA
 * schedules and workflow triggers use), so the form offers a few common presets
 * plus a raw cron escape hatch rather than inventing a second encoding.
 *
 * Reads are member-level; every write is MANAGER+ via <RoleGate> (disabled, not
 * hidden), mirroring the API's requireRole(MANAGER).
 */

/** Common cadences, expressed in the repo's canonical 5-field cron. Each `cron`
 *  must be UNIQUE — it is the <option> value and the reverse label lookup key. */
const CRON_PRESETS = [
  { id: 'weekdays9', cron: '0 9 * * 1-5' },
  { id: 'weekdays10', cron: '0 10 * * 1-5' },
  { id: 'daily9', cron: '0 9 * * *' },
  { id: 'mondays10', cron: '0 10 * * 1' },
  { id: 'fridays16', cron: '0 16 * * 5' },
] as const;

const KINDS = ['standup', 'planning'] as const;

type FormState = {
  id: string | null;
  kind: 'standup' | 'planning';
  cron: string;
  timezone: string;
  enabled: boolean;
  participantScope: 'members' | 'roster';
  maxParticipants: number;
  turnSeconds: string;
  autoDispatch: boolean;
};

const emptyForm = (): FormState => ({
  id: null,
  kind: 'standup',
  cron: '0 9 * * 1-5',
  timezone: typeof Intl !== 'undefined' ? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') : 'UTC',
  enabled: true,
  participantScope: 'members',
  maxParticipants: 25,
  turnSeconds: '',
  autoDispatch: false,
});

const fromSchedule = (s: CeremonySchedule): FormState => ({
  id: s.id,
  kind: s.kind === 'planning' ? 'planning' : 'standup',
  cron: s.cron,
  timezone: s.timezone,
  enabled: s.enabled,
  participantScope: s.participantScope === 'roster' ? 'roster' : 'members',
  maxParticipants: s.maxParticipants,
  turnSeconds: s.turnSeconds == null ? '' : String(s.turnSeconds),
  autoDispatch: s.autoDispatch,
});

export function CeremonySchedulesPanel({ projectId }: { projectId: number }) {
  const t = useTranslations('ceremonySchedules');
  const tc = useTranslations('common');
  const confirm = useConfirm();
  const canManage = usePermission('ceremonies.manageSchedules').allowed;

  const [schedules, setSchedules] = useState<CeremonySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [panelOpen, setPanelOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await ceremonySchedulesApi.list(projectId);
      setSchedules(res.schedules ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => { load(); }, [load]);

  const openCreate = useCallback(() => { setForm(emptyForm()); setPanelOpen(true); }, []);
  const openEdit = useCallback((s: CeremonySchedule) => { setForm(fromSchedule(s)); setPanelOpen(true); }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError('');
    const body: CeremonyScheduleInput = {
      kind: form.kind,
      cron: form.cron.trim(),
      timezone: form.timezone.trim() || 'UTC',
      enabled: form.enabled,
      participantScope: form.participantScope,
      maxParticipants: form.maxParticipants,
      turnSeconds: form.turnSeconds.trim() === '' ? null : Number(form.turnSeconds),
      autoDispatch: form.autoDispatch,
    };
    try {
      if (form.id) {
        const { schedule } = await ceremonySchedulesApi.update(form.id, body);
        setSchedules((prev) => prev.map((s) => (s.id === schedule.id ? schedule : s)));
      } else {
        const { schedule } = await ceremonySchedulesApi.create({ ...body, projectId });
        setSchedules((prev) => [schedule, ...prev]);
      }
      setPanelOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorSave'));
    } finally {
      setSaving(false);
    }
  }, [form, projectId, t]);

  const toggleEnabled = useCallback(async (s: CeremonySchedule) => {
    try {
      const { schedule } = await ceremonySchedulesApi.update(s.id, { enabled: !s.enabled });
      setSchedules((prev) => prev.map((x) => (x.id === schedule.id ? schedule : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorSave'));
    }
  }, [t]);

  const remove = useCallback(async (s: CeremonySchedule) => {
    if (!(await confirm({ message: t('confirmDelete'), destructive: true }))) return;
    try {
      await ceremonySchedulesApi.remove(s.id);
      setSchedules((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorDelete'));
    }
  }, [confirm, t]);

  const fmtDate = useCallback((iso: string | null) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }, []);

  /** Describe a cron with a friendly label when it matches a known preset. */
  const describeCron = useCallback((cron: string) => {
    const preset = CRON_PRESETS.find((p) => p.cron === cron);
    return preset ? t(`preset_${preset.id}`) : cron;
  }, [t]);

  const sorted = useMemo(
    () => [...schedules].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.kind.localeCompare(b.kind)),
    [schedules],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header: fluid — wraps instead of overflowing on narrow viewports. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{t('title')}</h3>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('subtitle')}</p>
        </div>
        <ViewToggle value={viewMode} onChange={setViewMode} />
        <RoleGate capability="ceremonies.manageSchedules">
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>{t('newSchedule')}</button>
        </RoleGate>
      </div>

      {error && (
        <div role="alert" style={{
          fontSize: 12, padding: '8px 12px', borderRadius: 8,
          background: 'var(--bg-elevated)', color: 'var(--danger, #ef4444)',
          border: '1px solid var(--border-subtle)',
        }}>{error}</div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tc('loading')}</div>
      ) : sorted.length === 0 ? (
        <div style={{
          fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6,
          padding: 20, borderRadius: 10, textAlign: 'center',
          background: 'var(--surface)', border: '1px dashed var(--border)',
        }}>{t('empty')}</div>
      ) : viewMode === 'card' ? (
        // Fluid auto-fit grid: single column near 360px, no horizontal overflow.
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }}>
          {sorted.map((s) => (
            <div key={s.id} style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8,
              opacity: s.enabled ? 1 : 0.6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{t(`kind_${s.kind}`)}</span>
                <span className={`badge ${s.enabled ? 'badge-green' : 'badge-gray'}`} style={{ fontSize: 10 }}>
                  {s.enabled ? t('enabled') : t('paused')}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
                {describeCron(s.cron)} · {s.timezone}
              </div>
              <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
                <dt>{t('colNextRun')}</dt><dd style={{ margin: 0, wordBreak: 'break-word' }}>{fmtDate(s.nextRunAt)}</dd>
                <dt>{t('colLastRun')}</dt><dd style={{ margin: 0, wordBreak: 'break-word' }}>{fmtDate(s.lastRunAt)}</dd>
                <dt>{t('colRoster')}</dt><dd style={{ margin: 0 }}>{t(`scope_${s.participantScope}`)}</dd>
              </dl>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto', paddingTop: 4 }}>
                <RoleGate capability="ceremonies.manageSchedules">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(s)}>{tc('edit')}</button>
                </RoleGate>
                <RoleGate capability="ceremonies.manageSchedules">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleEnabled(s)}>
                    {s.enabled ? t('pause') : t('resume')}
                  </button>
                </RoleGate>
                <RoleGate capability="ceremonies.manageSchedules">
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(s)}>{tc('delete')}</button>
                </RoleGate>
              </div>
            </div>
          ))}
        </div>
      ) : (
        // The table is the one wide element — it scrolls inside its own container
        // so the page body never scrolls horizontally.
        <div style={{ ...tableWrapStyle, overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>{t('colKind')}</th>
                <th style={thStyle}>{t('colCadence')}</th>
                <th style={thStyle}>{t('colNextRun')}</th>
                <th style={thStyle}>{t('colLastRun')}</th>
                <th style={thStyle}>{t('colStatus')}</th>
                <th style={thStyle}>{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.id} style={trStyle}>
                  <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>{t(`kind_${s.kind}`)}</td>
                  <td style={tdMutedStyle}>{describeCron(s.cron)} · {s.timezone}</td>
                  <td style={{ ...tdMutedStyle, whiteSpace: 'nowrap' }}>{fmtDate(s.nextRunAt)}</td>
                  <td style={{ ...tdMutedStyle, whiteSpace: 'nowrap' }}>{fmtDate(s.lastRunAt)}</td>
                  <td style={tdStyle}>
                    <span className={`badge ${s.enabled ? 'badge-green' : 'badge-gray'}`} style={{ fontSize: 10 }}>
                      {s.enabled ? t('enabled') : t('paused')}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <RoleGate capability="ceremonies.manageSchedules">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(s)}>{tc('edit')}</button>
                      </RoleGate>
                      <RoleGate capability="ceremonies.manageSchedules">
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(s)}>{tc('delete')}</button>
                      </RoleGate>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail/edit lives in a SlideOutPanel — modals are reserved for destructive confirms. */}
      <SlideOutPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title={form.id ? t('editSchedule') : t('newSchedule')}
        width="min(520px, 96vw)"
      >
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="label" htmlFor="cs-kind">{t('fieldKind')}</label>
            <Select
              id="cs-kind"
              className="input"
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as FormState['kind'] }))}
            >
              {KINDS.map((k) => <option key={k} value={k}>{t(`kind_${k}`)}</option>)}
            </Select>
          </div>

          <div>
            <label className="label" htmlFor="cs-preset">{t('fieldCadence')}</label>
            <Select
              id="cs-preset"
              className="input"
              value={CRON_PRESETS.some((p) => p.cron === form.cron) ? form.cron : 'custom'}
              onChange={(e) => {
                if (e.target.value !== 'custom') setForm((f) => ({ ...f, cron: e.target.value }));
              }}
            >
              {CRON_PRESETS.map((p) => <option key={p.id} value={p.cron}>{t(`preset_${p.id}`)}</option>)}
              <option value="custom">{t('presetCustom')}</option>
            </Select>
          </div>

          <div>
            <label className="label" htmlFor="cs-cron">{t('fieldCron')}</label>
            <input
              id="cs-cron"
              className="input"
              value={form.cron}
              placeholder="0 9 * * 1-5"
              onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
            />
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('cronHelp')}</p>
          </div>

          <div>
            <label className="label" htmlFor="cs-tz">{t('fieldTimezone')}</label>
            <input
              id="cs-tz"
              className="input"
              value={form.timezone}
              onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
            />
          </div>

          <div>
            <label className="label" htmlFor="cs-scope">{t('fieldRoster')}</label>
            <Select
              id="cs-scope"
              className="input"
              value={form.participantScope}
              onChange={(e) => setForm((f) => ({ ...f, participantScope: e.target.value as FormState['participantScope'] }))}
            >
              <option value="members">{t('scope_members')}</option>
              <option value="roster">{t('scope_roster')}</option>
            </Select>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('rosterHelp')}</p>
          </div>

          {/* Two-up on comfortable widths, stacked near 360px. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ flex: '1 1 160px', minWidth: 0 }}>
              <label className="label" htmlFor="cs-max">{t('fieldMaxParticipants')}</label>
              <input
                id="cs-max"
                className="input"
                type="number"
                min={1}
                max={100}
                value={form.maxParticipants}
                onChange={(e) => setForm((f) => ({ ...f, maxParticipants: Number(e.target.value) }))}
              />
            </div>
            <div style={{ flex: '1 1 160px', minWidth: 0 }}>
              <label className="label" htmlFor="cs-turn">{t('fieldTurnSeconds')}</label>
              <input
                id="cs-turn"
                className="input"
                type="number"
                min={10}
                max={900}
                value={form.turnSeconds}
                placeholder={t('turnSecondsPlaceholder')}
                onChange={(e) => setForm((f) => ({ ...f, turnSeconds: e.target.value }))}
              />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', minHeight: 44 }}>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
            />
            <span>
              {t('fieldEnabled')}
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('enabledHelp')}</span>
            </span>
          </label>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', minHeight: 44 }}>
            <input
              type="checkbox"
              checked={form.autoDispatch}
              onChange={(e) => setForm((f) => ({ ...f, autoDispatch: e.target.checked }))}
              style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
            />
            <span>
              {t('fieldAutoDispatch')}
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{t('autoDispatchHelp')}</span>
            </span>
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setPanelOpen(false)}>{tc('cancel')}</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={saving || !canManage || !form.cron.trim()}
            >
              {saving ? tc('saving') : tc('save')}
            </button>
          </div>
        </div>
      </SlideOutPanel>
    </div>
  );
}
