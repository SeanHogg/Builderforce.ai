/**
 * "Do next" (PRD 33 §4.1, 28% column; D13): the site's open fixes for the
 * home's filter, the chosen goal's areas first and the API's rank (impact ÷
 * effort) within them — each THE fix card, compact (before → after, impact, who
 * makes it). "Find fixes now" runs the sweep (once an hour per site; the API's
 * 429 is said in place); "View all" opens the `fixes` kind; a card the `fix` kind.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ApiRequestError } from '@/lib/apiClient';
import { replayApi } from '@/lib/replayApi';
import { PRESCRIPTION_SWEEP_LIMIT_STATUS } from '@/lib/replayPrescriptionsApi';
import { useErrorText } from '@/i18n/useErrorMessage';
import { RoleGate } from '@/components/RoleGate';
import { PrescriptionCard } from '@/components/replay/prescriptions/PrescriptionCard';
import { usePrescriptionsFor } from '@/components/replay/prescriptions/usePrescriptionsFor';
import { isOpenPrescription, rankForGoal } from '@/components/replay/prescriptions/prescriptionModel';
import { useInsightsScope } from '../insightsScope';
import { usePanel } from '../usePanel';

/** Fixes the 1440×900 home has room for (D16: nothing below the fold). */
export const HOME_FIX_ROWS = 4;

export function DoNext() {
  const t = useTranslations('insights');
  const errorText = useErrorText();
  const { siteId, filter, goal } = useInsightsScope();
  const { push } = usePanel();
  const { items, loading, error } = usePrescriptionsFor({ siteId, filter });
  const [sweeping, setSweeping] = useState(false);
  const [sweepNote, setSweepNote] = useState<{ text: string; tone: 'status' | 'alert' } | null>(null);
  const ranked = rankForGoal(items.filter(isOpenPrescription), goal).slice(0, HOME_FIX_ROWS);

  const sweep = async () => {
    setSweeping(true);
    setSweepNote(null);
    try {
      const result = await replayApi.sweepPrescriptions(siteId);
      setSweepNote({ text: t('fixes.sweepResult', { found: result.found, created: result.created }), tone: 'status' });
    } catch (failure) {
      const limited = failure instanceof ApiRequestError && failure.status === PRESCRIPTION_SWEEP_LIMIT_STATUS;
      setSweepNote({ text: limited ? t('fixes.sweepLimited') : errorText(failure), tone: limited ? 'status' : 'alert' });
    } finally {
      setSweeping(false);
    }
  };

  return (
    <section aria-labelledby="insights-next-heading" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0, minHeight: 0, flex: '1 1 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <h3 id="insights-next-heading" style={{ margin: 0, fontSize: 'var(--font-size-card-title)' }}>{t('overview.doNextTitle')}</h3>
        <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
          <RoleGate capability="insights.actOnFixes">
            <button type="button" className="btn-secondary" style={{ minHeight: 44 }} disabled={sweeping} aria-busy={sweeping} onClick={() => void sweep()}>
              {sweeping ? t('fixes.finding') : t('fixes.findNow')}
            </button>
          </RoleGate>
          <button type="button" className="btn-ghost" style={{ minHeight: 44 }} onClick={() => push({ kind: 'fixes', id: '' })}>
            {t('fixes.viewAll')}
          </button>
        </div>
      </div>
      {sweepNote && (
        <p role={sweepNote.tone} style={{ margin: 0, fontSize: 'var(--font-size-small)', color: sweepNote.tone === 'alert' ? 'var(--error)' : 'var(--text-secondary)' }}>
          {sweepNote.text}
        </p>
      )}
      <div style={{ minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {error && <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{t('fixes.error')} {error}</p>}
        {!error && loading && items.length === 0 && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('fixes.loading')}</p>}
        {!error && !loading && ranked.length === 0 && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('overview.doNextEmpty')}</p>}
        {ranked.map((p) => <PrescriptionCard key={p.id} compact siteId={siteId} prescription={p} push={push} />)}
      </div>
    </section>
  );
}
