/**
 * One workspace's two Insights switches (PRD 33 D8, D9), edited by an operator:
 *
 *   - excluded — never record this workspace's members on builderforce.ai (D9);
 *   - free-allowance override — free recordings a month for this workspace; 0 is
 *     the real-payment validation workspace (D8), empty = the catalog default.
 *
 * Saved with one PATCH, which the API audits (`REPLAY_TENANT_SETTINGS_CHANGED`).
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { replayOpsApi, type ReplayTenantSettings } from '@/lib/replayOpsApi';
import { AdminError, AdminLoading, errText, useAdminData } from '@/components/admin/adminShared';
import { insightsOpsCardStyle, insightsOpsInputStyle } from './insightsOpsStyles';

/** '' = clear (null); otherwise a whole number ≥ 0, or undefined when invalid. */
export function parseOverride(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : undefined;
}

export function ReplayTenantSettingsForm({ tenantId }: { tenantId: number }) {
  const t = useTranslations('admin.insightsOps.settings');
  const { data, loading, error, setData } = useAdminData<ReplayTenantSettings>(
    () => replayOpsApi.tenantSettings(tenantId),
    [tenantId],
  );
  const [excluded, setExcluded] = useState(false);
  const [override, setOverride] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    setExcluded(data.replayExcluded);
    setOverride(data.replayFreeAllowanceOverride == null ? '' : String(data.replayFreeAllowanceOverride));
  }, [data]);

  const parsed = parseOverride(override);
  const dirty = data != null && (excluded !== data.replayExcluded || parsed !== data.replayFreeAllowanceOverride);

  const save = async () => {
    if (parsed === undefined) {
      setSaveError(t('invalidOverride'));
      return;
    }
    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      const next = await replayOpsApi.updateTenantSettings(tenantId, {
        replayExcluded: excluded,
        replayFreeAllowanceOverride: parsed,
      });
      setData(next);
      setSaved(true);
    } catch (e) {
      setSaveError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <div style={insightsOpsCardStyle}><AdminLoading /></div>;

  return (
    <form
      style={insightsOpsCardStyle}
      aria-labelledby={`insights-ops-settings-${tenantId}`}
      onSubmit={(e) => { e.preventDefault(); void save(); }}
    >
      <h4 id={`insights-ops-settings-${tenantId}`} style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: 'var(--text-strong)' }}>
        {t('title')}
      </h4>
      <AdminError message={error || saveError} />

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minHeight: 44, marginBottom: 12, cursor: 'pointer' }}>
        <input
          type="checkbox"
          role="switch"
          aria-checked={excluded}
          checked={excluded}
          disabled={!data || saving}
          onChange={(e) => { setExcluded(e.target.checked); setSaved(false); }}
          style={{ marginTop: 3, width: 18, height: 18 }}
        />
        <span>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t('excluded')}</span>
          <span className="text-muted" style={{ display: 'block', fontSize: 12 }}>{t('excludedHint')}</span>
        </span>
      </label>

      <label htmlFor={`insights-ops-override-${tenantId}`} style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
        {t('override')}
      </label>
      <p className="text-muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>{t('overrideHint')}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          id={`insights-ops-override-${tenantId}`}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={override}
          placeholder={t('overridePlaceholder')}
          disabled={!data || saving}
          aria-invalid={parsed === undefined}
          onChange={(e) => { setOverride(e.target.value); setSaved(false); }}
          style={{ ...insightsOpsInputStyle, flex: '1 1 140px' }}
        />
        <button
          type="button"
          className="btn-ghost"
          style={{ minHeight: 44 }}
          disabled={!data || saving || override === ''}
          onClick={() => { setOverride(''); setSaved(false); }}
        >
          {t('clear')}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="submit" className="btn-primary" style={{ minHeight: 44 }} disabled={!dirty || saving}>
          {saving ? t('saving') : t('save')}
        </button>
        {saved && <span role="status" style={{ fontSize: 12, color: 'var(--success)' }}>{t('saved')}</span>}
      </div>
    </form>
  );
}
