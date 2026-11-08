import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import {
  listGovernanceGaps, listSocEvidence, type GovernanceGap, type SocEvidenceEntry,
} from '@/lib/governanceDevsecopsApi';

/**
 * The DevSecOps half of the SOC 2 tracker (PRD 08 §10): the evidence the platform wrote ITSELF as
 * changes were scanned, reviewed and merged (with its provenance), and the governance auditor's open
 * gaps - merged changes that were never scanned or reviewed, controls with no evidence in 90 days.
 * A gap is an open question, shown apart from evidence so it can never read as proof.
 */
const AUTOMATED = 'automated';

/** `auto:merge:<id>` -> the provenance kind shown next to the evidence. */
const sourceKind = (sourceRef: string | null): string => sourceRef?.split(':')[1] ?? '';

export function Soc2AutomationPanel() {
  const t = useTranslations('soc2Tracker.automation');
  const fmt = useFormat();
  const [evidence, setEvidence] = useState<SocEvidenceEntry[] | null>(null);
  const [gaps, setGaps] = useState<GovernanceGap[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([listSocEvidence(), listGovernanceGaps()])
      .then(([e, g]) => { setEvidence(e); setGaps(g); })
      .catch(() => setError(true));
  }, []);

  if (error) return <div role="alert" style={{ color: 'var(--error-text)', marginTop: 16 }}>{t('loadFailed')}</div>;
  if (!evidence || !gaps) return null;

  const automated = evidence.filter((e) => e.evidenceType === AUTOMATED).length;

  return (
    <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section aria-labelledby="soc2-evidence-title">
        <div style={heading}>
          <div id="soc2-evidence-title" style={{ fontSize: 'var(--font-size-body)', fontWeight: 600 }}>{t('evidenceTitle')}</div>
          <div style={muted}>{t('evidenceSummary', { automated, total: evidence.length })}</div>
        </div>
        {evidence.length === 0 ? (
          <div style={muted}>{t('evidenceEmpty')}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>{t('colControl')}</th>
                  <th style={th}>{t('colTitle')}</th>
                  <th style={th}>{t('colType')}</th>
                  <th style={th}>{t('colSource')}</th>
                  <th style={th}>{t('colWhen')}</th>
                </tr>
              </thead>
              <tbody>
                {evidence.map((e) => (
                  <tr key={e.id}>
                    <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{e.controlRef}</td>
                    <td style={td}>
                      {e.url ? <a href={e.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{e.title}</a> : e.title}
                    </td>
                    <td style={td}>{t(`type.${e.evidenceType === AUTOMATED ? 'automated' : e.evidenceType === 'override' ? 'override' : 'manual'}`)}</td>
                    <td style={{ ...td, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }} title={e.sourceRef ?? undefined}>
                      {[sourceKind(e.sourceRef), e.note].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt.date(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="soc2-gaps-title">
        <div style={heading}>
          <div id="soc2-gaps-title" style={{ fontSize: 'var(--font-size-body)', fontWeight: 600 }}>{t('gapsTitle')}</div>
          <div style={muted}>{t('gapsSummary', { n: gaps.length })}</div>
        </div>
        {gaps.length === 0 ? (
          <div style={muted}>{t('gapsEmpty')}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>{t('colGap')}</th>
                  <th style={th}>{t('colDetail')}</th>
                  <th style={th}>{t('colDetected')}</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((g) => (
                  <tr key={g.id}>
                    <td style={{ ...td, fontWeight: 600, color: 'var(--warning-text)' }}>{t(`gap.${g.gapType}`)}</td>
                    <td style={td}>{g.detail ?? g.subjectRef}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmt.date(g.detectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const heading: React.CSSProperties = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 };
const muted: React.CSSProperties = { fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-small)' };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontWeight: 600 };
const td: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top' };
