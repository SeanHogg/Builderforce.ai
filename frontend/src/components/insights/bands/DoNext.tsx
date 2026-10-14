/**
 * "Do next" (PRD 33 §4.1, 28% column; D13): the site's open fixes for the
 * home's filter, the chosen goal's areas first and the API's rank (impact ÷
 * effort) within them — each THE fix card, compact (before → after, impact, who
 * makes it). "Find fixes now" runs the sweep (once an hour per site; the API's
 * 429 is said in place); "Pages" opens the `pages` kind (key pages by
 * opportunity); "View all" opens the `fixes` kind; a card the `fix` kind.
 * "Apply all" bundles the visible open fixes on the selected page (the Page
 * stage's route, else the top fix's page) into ONE prompt (`PagePromptBundle`:
 * copy, or apply in the composer where the host has one).
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
import { PagePromptBundle } from '@/components/replay/prompt/PagePromptBundle';
import { useInsightsScope } from '../insightsScope';
import { usePanel } from '../usePanel';

/** Fixes the 1440×900 home has room for (D16: nothing below the fold). */
export const HOME_FIX_ROWS = 4;

export function DoNext() {
  const t = useTranslations('insights');
  const errorText = useErrorText();
  const { siteId, filter, goal, route } = useInsightsScope();
  const { push } = usePanel();
  const { items, loading, error } = usePrescriptionsFor({ siteId, filter });
  const [sweeping, setSweeping] = useState(false);
  const [sweepNote, setSweepNote] = useState<{ text: string; tone: 'status' | 'alert' } | null>(null);
  const [applyAll, setApplyAll] = useState(false);
  const ranked = rankForGoal(items.filter(isOpenPrescription), goal).slice(0, HOME_FIX_ROWS);
  const page = route ?? ranked.find((p) => p.pagePath)?.pagePath ?? null;
  const pageFixes = page ? ranked.filter((p) => p.pagePath === page) : [];

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
          <button
            type="button"
            className={applyAll ? 'btn-secondary' : 'btn-ghost'}
            style={{ minHeight: 44 }}
            disabled={pageFixes.length === 0}
            aria-expanded={applyAll}
            onClick={() => setApplyAll((open) => !open)}
          >
            {t('fixes.applyAll')}
          </button>
          <button type="button" className="btn-ghost" style={{ minHeight: 44 }} onClick={() => push({ kind: 'pages', id: '' })}>
            {t('pages.open')}
          </button>
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
        {applyAll && page && pageFixes.length > 0 && (
          <section aria-label={t('fixes.applyAllTitle', { route: page })} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-card)' }}>
            <strong style={{ fontSize: 'var(--font-size-small)', overflowWrap: 'anywhere' }}>{t('fixes.applyAllTitle', { route: page })}</strong>
            <PagePromptBundle siteId={siteId} path={page} fixes={pageFixes} />
          </section>
        )}
        {error && <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{t('fixes.error')} {error}</p>}
        {!error && loading && items.length === 0 && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('fixes.loading')}</p>}
        {!error && !loading && ranked.length === 0 && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('overview.doNextEmpty')}</p>}
        {ranked.map((p) => <PrescriptionCard key={p.id} compact siteId={siteId} prescription={p} push={push} />)}
      </div>
    </section>
  );
}
