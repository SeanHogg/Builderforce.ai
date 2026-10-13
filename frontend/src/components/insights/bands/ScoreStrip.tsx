/**
 * Score by release (PRD 33 §4.1 Do next, §5.2 "Measure"): the latest releases,
 * newest first, each with the number of fixes it shipped and one dot per fix
 * coloured by its verdict (worked · no effect · worse · still measuring) — from
 * `releases` + each release's `releaseReport`. A release opens the `release`
 * kind (its ledger, with Revert where offered).
 */

import { useTranslations } from 'next-intl';
import type { ReplayReleaseDto, ReplayReleaseReportDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useAdminData } from '@/components/admin/adminShared';
import { VERDICT_TONE } from '@/components/replay/prescriptions/PrescriptionParts';
import { useInsightsScope } from '../insightsScope';
import { usePanel } from '../usePanel';

/** Releases the strip has room for. */
export const SCORE_STRIP_RELEASES = 6;

interface ReleaseScore {
  release: ReplayReleaseDto;
  report: ReplayReleaseReportDto | null;
}

export async function loadReleaseScores(siteId: string): Promise<ReleaseScore[]> {
  const releases = [...await replayApi.listReleases(siteId)]
    .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt))
    .slice(0, SCORE_STRIP_RELEASES);
  const reports = await Promise.allSettled(releases.map((release) => replayApi.releaseReport(siteId, release.releaseKey)));
  return releases.map((release, index) => {
    const settled = reports[index];
    return { release, report: settled?.status === 'fulfilled' ? settled.value : null };
  });
}

export function ScoreStrip() {
  const t = useTranslations('insights');
  const tRx = useTranslations('replay.prescription');
  const { siteId } = useInsightsScope();
  const { push } = usePanel();
  const { data } = useAdminData(() => loadReleaseScores(siteId), [siteId]);
  if (!data || data.length === 0) return null;
  const shipped = data.some((row) => (row.report?.prescriptions.length ?? 0) > 0);

  return (
    <section aria-label={t('release.strip.aria')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0, flex: '0 0 auto' }}>
      <h4 style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('release.strip.title')}</h4>
      {!shipped && <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('release.strip.empty')}</p>}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 'var(--space-1)', overflowX: 'auto' }}>
        {data.map(({ release, report }) => {
          const label = release.label ?? t('overview.releaseOrdinal', { n: release.ordinal });
          const fixes = report?.prescriptions ?? [];
          const worked = fixes.filter((fix) => fix.measured?.verdict === 'worked').length;
          const worse = fixes.filter((fix) => fix.measured?.verdict === 'worse').length;
          return (
            <li key={release.releaseKey} data-testid="score-release" style={{ flex: '0 0 auto' }}>
              <button
                type="button"
                className="btn-ghost"
                aria-label={t('release.strip.label', { label, count: fixes.length, worked, worse })}
                onClick={() => push({ kind: 'release', id: release.releaseKey })}
                style={{ minHeight: 44, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: 'var(--space-1) var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}
              >
                <span style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <span style={{ fontSize: 'var(--font-size-small)', fontVariantNumeric: 'tabular-nums' }}>{fixes.length}</span>
                  {fixes.map((fix) => {
                    const verdict = fix.measured?.verdict ?? fix.status;
                    return (
                      <span
                        key={fix.id}
                        data-verdict={verdict}
                        title={tRx(`status.${verdict}`)}
                        aria-hidden="true"
                        style={{ width: 8, height: 8, borderRadius: '50%', background: VERDICT_TONE[verdict] ?? 'var(--text-secondary)', display: 'inline-block' }}
                      />
                    );
                  })}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
