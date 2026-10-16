/**
 * The operator's Insights credit grant for one workspace (PRD 33 D17).
 *
 * Confirmed first (`useConfirm` — it moves money-equivalent credit), then one POST
 * that the API audits BEFORE it ledgers (`replay-grant:<audit id>`). The result
 * names the audit reference so the operator can find the row in the audit log.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { useFormat } from '@/i18n/useFormat';
import type { ReplayCreditGrantResult } from '@builderforce/interaction-contract';
import { replayOpsApi } from '@/lib/replayOpsApi';
import { AdminError, errText } from '@/components/admin/adminShared';
import { insightsOpsCardStyle, insightsOpsInputStyle } from './insightsOpsStyles';

/** Mirrors the API's `REPLAY_GRANT_MAX_UNITS` — the client only pre-checks. */
const MAX_UNITS = 1_000_000;
const MIN_REASON = 3;

export function ReplayGrantForm({ tenantId, tenantName }: { tenantId: number; tenantName: string }) {
  const t = useTranslations('admin.insightsOps.grant');
  const fmt = useFormat();
  const confirm = useConfirm();
  const [units, setUnits] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReplayCreditGrantResult | null>(null);

  const unitCount = /^\d+$/.test(units.trim()) ? Number(units.trim()) : NaN;
  const valid = Number.isInteger(unitCount) && unitCount > 0 && unitCount <= MAX_UNITS && reason.trim().length >= MIN_REASON;

  const submit = async () => {
    if (!valid) {
      setError(t('invalid', { max: fmt.number(MAX_UNITS) }));
      return;
    }
    const ok = await confirm({
      title: t('confirmTitle'),
      message: t('confirmMessage', { units: fmt.number(unitCount), tenant: tenantName }),
      confirmLabel: t('confirmLabel'),
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const granted = await replayOpsApi.grantCredits({ tenantId, units: unitCount, reason: reason.trim() });
      setResult(granted);
      setUnits('');
      setReason('');
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      style={insightsOpsCardStyle}
      aria-labelledby={`insights-ops-grant-${tenantId}`}
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <h4 id={`insights-ops-grant-${tenantId}`} style={{ margin: '0 0 4px', fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-strong)' }}>
        {t('title')}
      </h4>
      <p className="text-muted" style={{ fontSize: 'var(--font-size-small)', margin: '0 0 12px' }}>{t('hint')}</p>
      <AdminError message={error} />

      <label htmlFor={`insights-ops-units-${tenantId}`} style={{ display: 'block', fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
        {t('units')}
      </label>
      <input
        id={`insights-ops-units-${tenantId}`}
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_UNITS}
        step={1}
        value={units}
        disabled={busy}
        onChange={(e) => setUnits(e.target.value)}
        style={{ ...insightsOpsInputStyle, width: '100%', marginBottom: 12 }}
      />

      <label htmlFor={`insights-ops-reason-${tenantId}`} style={{ display: 'block', fontSize: 'var(--font-size-small)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
        {t('reason')}
      </label>
      <textarea
        id={`insights-ops-reason-${tenantId}`}
        value={reason}
        maxLength={500}
        rows={2}
        placeholder={t('reasonPlaceholder')}
        disabled={busy}
        onChange={(e) => setReason(e.target.value)}
        style={{ ...insightsOpsInputStyle, width: '100%', resize: 'vertical', marginBottom: 12 }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="submit" className="btn-primary" style={{ minHeight: 44 }} disabled={busy || units === '' || reason.trim() === ''}>
          {busy ? t('granting') : t('submit')}
        </button>
        {result && (
          <span role="status" style={{ fontSize: 'var(--font-size-small)', color: 'var(--success)', overflowWrap: 'anywhere' }}>
            {t('done', { units: fmt.number(result.units), credits: fmt.number(result.credits), reference: result.reference })}
          </span>
        )}
      </div>
    </form>
  );
}
