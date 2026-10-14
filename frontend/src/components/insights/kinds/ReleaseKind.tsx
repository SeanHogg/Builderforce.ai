/**
 * The `release` panel kind (PRD 33 §4.1, §5.2 "Measure"): the improvement ledger
 * of one release — every fix it shipped, its verdict and its measured before →
 * after, and Revert where the API offers it (`next` holds `revert` only on a
 * `worse` verdict after a published fix). The level id is the release key.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayReleaseReportDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useFormat } from '@/i18n/useFormat';
import { useAdminData } from '@/components/admin/adminShared';
import { PrescriptionActions } from '@/components/replay/prescriptions/PrescriptionActions';
import { AreaChip, StatusChip, useFindingTitle } from '@/components/replay/prescriptions/PrescriptionParts';
import { fixLevel } from '@/components/replay/prescriptions/PrescriptionCard';
import { usePrescriptionsFor } from '@/components/replay/prescriptions/usePrescriptionsFor';
import type { InsightPanelKindProps } from '../panelKinds';
import { PanelPending } from './PanelPending';

const REVERT_ONLY = ['revert'] as const;

export function ReleaseKind({ siteId, id, push }: InsightPanelKindProps) {
  const t = useTranslations('insights.release');
  const tRx = useTranslations('replay.prescription');
  const fmt = useFormat();
  const findingText = useFindingTitle();
  const { data, loading, error } = useAdminData<ReplayReleaseReportDto>(() => replayApi.releaseReport(siteId, id), [siteId, id]);
  const { items } = usePrescriptionsFor({ siteId });
  const byId = useMemo(() => new Map(items.map((p) => [p.id, p])), [items]);
  if (!data) return <PanelPending loading={loading} error={error} />;
  const num = (value: number | null) => (value == null ? '—' : fmt.number(value, { maximumFractionDigits: 3 }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 'var(--font-size-card-title)', overflowWrap: 'anywhere' }}>{t('title', { label: data.label ?? data.releaseKey.slice(0, 12) })}</h3>
        {data.firstSeenAt && <p style={{ margin: 'var(--space-1) 0 0', color: 'var(--text-secondary)' }}>{t('firstSeen', { date: fmt.date(data.firstSeenAt) })}</p>}
      </div>
      {data.prescriptions.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('empty')}</p>
      ) : (
        <ol data-testid="release-fixes" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {data.prescriptions.map((row) => {
            const full = byId.get(row.id);
            const title = full ? findingText(full) : tRx('rule.fallback', { ruleId: row.ruleId });
            return (
              <li
                key={row.id}
                data-verdict={row.measured?.verdict ?? row.status}
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-card)', minWidth: 0 }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <AreaChip area={row.area} />
                  <span style={{ marginLeft: 'auto' }}><StatusChip status={row.measured?.verdict ?? row.status} /></span>
                </div>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ minHeight: 44, padding: 0, justifyContent: 'flex-start', textAlign: 'left', fontWeight: 600, overflowWrap: 'anywhere' }}
                  aria-label={t('openAria', { title })}
                  onClick={() => push(fixLevel(row.id, 'measure'))}
                >
                  {title}
                </button>
                <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
                  {row.measured ? tRx('measured.beforeAfter', { before: num(row.measured.before), after: num(row.measured.after) }) : t('notMeasured')}
                </p>
                {full && <PrescriptionActions siteId={siteId} prescription={full} only={REVERT_ONLY} onChanged={() => undefined} compact />}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
