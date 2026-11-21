import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { LocalCollection } from '@/components/pm/LocalCollection';
import type { Rehearsal, RehearsalComparison, RehearsalStep } from '@/lib/agentOpsApi';
import { button, card, mono, muted, sectionTitle } from './agentOpsStyles';
import { comparisonDescriptor, rehearsalStepsDescriptor } from './agentOpsDescriptors';

/**
 * The two read-outs a rehearsal produces: one run's REPORT (what it would have done,
 * step by step) and a two-run COMPARISON (per-operation deltas). Both lists render
 * through the shared Collection; the panel above owns which one is open.
 */

const headerRow = { display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' } as const;

export function RehearsalReportCard({ report, onClose }: { report: { rehearsal: Rehearsal; steps: RehearsalStep[] }; onClose: () => void }) {
  const t = useTranslations('agentOps');
  const steps = useMemo(() => rehearsalStepsDescriptor(t), [t]);
  const { rehearsal } = report;
  return (
    <div style={card}>
      <div style={headerRow}>
        <h2 style={{ ...sectionTitle, marginBottom: 0 }}>{t('rehearsal.reportTitle')}</h2>
        <button type="button" style={button()} onClick={onClose}>{t('close')}</button>
      </div>
      {rehearsal.frozenRef && (
        <p style={{ ...muted, marginTop: 8 }}>
          {t('rehearsal.frozenAt')} <span style={mono}>{rehearsal.frozenRef}</span>
        </p>
      )}
      {rehearsal.summary && (
        <p style={{ ...muted, marginTop: 8, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{rehearsal.summary}</p>
      )}
      {rehearsal.errorMessage && (
        <p style={{ ...muted, marginTop: 8, color: 'var(--danger)' }}>{rehearsal.errorMessage}</p>
      )}
      <h3 style={{ ...sectionTitle, marginTop: 14 }}>{t('rehearsal.suppressedTitle')}</h3>
      {report.steps.length === 0 ? (
        <p style={muted}>{t('rehearsal.noSteps')}</p>
      ) : (
        <LocalCollection descriptor={steps} rows={report.steps} searchText={(s) => `${s.op} ${s.target ?? ''}`} />
      )}
    </div>
  );
}

export function RehearsalComparisonCard({ comparison, onClose }: { comparison: RehearsalComparison; onClose: () => void }) {
  const t = useTranslations('agentOps');
  const operations = useMemo(() => comparisonDescriptor(t), [t]);
  return (
    <div style={card} aria-live="polite">
      <div style={headerRow}>
        <h2 style={{ ...sectionTitle, marginBottom: 0 }}>{t('rehearsal.comparisonTitle')}</h2>
        <button type="button" style={button()} onClick={onClose}>{t('close')}</button>
      </div>
      <p style={{ ...muted, margin: '8px 0 12px' }}>
        {comparison.sameTicket ? t('rehearsal.sameTicket') : t('rehearsal.differentTicket')} · {comparison.sameFrozenRef ? t('rehearsal.sameRef') : t('rehearsal.differentRef')}
      </p>
      <LocalCollection descriptor={operations} rows={comparison.operations} searchText={(o) => o.op} />
    </div>
  );
}
