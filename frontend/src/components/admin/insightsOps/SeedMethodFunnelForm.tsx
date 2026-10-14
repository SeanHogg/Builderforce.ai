/**
 * Seed "The method" funnel on builderforce.ai's own Insights site (PRD 33 §5.3.6).
 *
 * The operator names the Builderforce workspace's site (its id is on the site's
 * settings page); one POST creates the four method smart events and the funnel
 * `/ → composer.submit → idea.read → proof.choose → proof.build → proof.grade`.
 * Idempotent server-side, so pressing it twice is safe and says "already seeded".
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayMethodFunnelSeedDto } from '@builderforce/interaction-contract';
import { replayOpsApi } from '@/lib/replayOpsApi';
import { AdminError, errText } from '@/components/admin/adminShared';
import { insightsOpsCardStyle, insightsOpsInputStyle } from './insightsOpsStyles';

const SITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function SeedMethodFunnelForm() {
  const t = useTranslations('admin.insightsOps.methodFunnel');
  const [siteId, setSiteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReplayMethodFunnelSeedDto | null>(null);

  const submit = async () => {
    const id = siteId.trim();
    if (!SITE_ID.test(id)) {
      setError(t('invalid'));
      return;
    }
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await replayOpsApi.seedMethodFunnel(id));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const created = result && (result.createdFunnel || result.createdSmartEvents.length > 0);
  return (
    <form
      style={insightsOpsCardStyle}
      aria-labelledby="insights-ops-method-funnel"
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <h4 id="insights-ops-method-funnel" style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: 'var(--text-strong)' }}>
        {t('title')}
      </h4>
      <p className="text-muted" style={{ fontSize: 12, margin: '0 0 12px' }}>{t('hint')}</p>
      <AdminError message={error} />
      <label htmlFor="insights-ops-method-site" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
        {t('siteLabel')}
      </label>
      <input
        id="insights-ops-method-site"
        value={siteId}
        disabled={busy}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setSiteId(e.target.value)}
        style={{ ...insightsOpsInputStyle, width: '100%', marginBottom: 12 }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="submit" className="btn-primary" style={{ minHeight: 44 }} disabled={busy || siteId.trim() === ''}>
          {busy ? t('seeding') : t('submit')}
        </button>
        {result && (
          <span role="status" style={{ fontSize: 12, color: 'var(--success)', overflowWrap: 'anywhere' }}>
            {created ? t('done', { events: result.createdSmartEvents.length }) : t('already')}
          </span>
        )}
      </div>
    </form>
  );
}
