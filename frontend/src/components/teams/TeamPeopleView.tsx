'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getTeamPeopleScores, type PersonScore, type ScoredMeasure, type TeamPeopleScores } from '@/lib/personScores';
import { faultMessage } from '@/lib/apiClient';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';

/**
 * Workforce → Teams → People (PRD 41 §D14, WS22). The manager-facing view: per-contributor,
 * per-role quality scores derived deterministically from run-delta outcomes and WS16 labels,
 * risk-adjusted (observed ÷ expected) and shrunk toward the team. A ranked table is never the
 * default — this renders one block per person, with the 95% interval drawn and an
 * "outside limits" flag (the only call-out, §D14.5). A score below the 20-final-labelled-run
 * minimum shows `insufficient-data`, never a number (§D14.4).
 *
 * Read-only and self-loading: the host (TeamDetailPanel) mounts it for the open team.
 */
export function TeamPeopleView({ teamId }: { teamId: number }) {
  const t = useTranslations('workforce.teams.people');
  const [data, setData] = useState<TeamPeopleScores | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getTeamPeopleScores(teamId));
    } catch (e) {
      setError(faultMessage(e, t('errLoad')));
    } finally {
      setLoading(false);
    }
  }, [teamId, t]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p style={tdMutedStyle}>{t('loading')}</p>;
  if (error) return <p style={{ ...tdMutedStyle, color: 'var(--error, #c0392b)' }}>{error}</p>;
  if (!data) return null;

  if (data.people.length === 0) {
    return (
      <p style={tdMutedStyle}>
        {data.humanScoringEnabled ? t('empty') : t('emptyScoringOff')}
      </p>
    );
  }

  // Sorted by the posterior mean of the run-quality measure, highest first — but a ranked
  // table is not the default; each person is a block, with the interval drawn (§D14.5).
  const ranked = [...data.people].sort((a, b) => qualityOf(b.scores) - qualityOf(a.scores));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <p style={{ ...tdMutedStyle, margin: 0 }}>
        {t('lede', { days: data.windowDays })}
        {!data.humanScoringEnabled && <> {t('scoringOffNote')}</>}
      </p>
      {ranked.map((person) => (
        <PersonBlock key={person.contributorId} name={person.displayName} kind={person.kind} scores={person.scores} t={t} />
      ))}
    </div>
  );
}

/** The run-quality posterior mean used for ordering (insufficient-data sorts last). */
function qualityOf(scores: PersonScore[]): number {
  for (const s of scores) {
    if (s.status !== 'ok') continue;
    const q = s.measures.find((m) => m.id === 'run-quality');
    if (q?.posteriorMean != null) return q.posteriorMean;
  }
  return -1;
}

type T = ReturnType<typeof useTranslations>;

function PersonBlock({ name, kind, scores, t }: { name: string; kind: string; scores: PersonScore[]; t: T }) {
  return (
    <section style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 16 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--font-size-body, 14px)', fontWeight: 600 }}>{name}</h3>
        <span style={tdMutedStyle}>{t(`kind.${kind}`, { defaultValue: kind })}</span>
      </header>
      {scores.length === 0 ? (
        <p style={{ ...tdMutedStyle, margin: 0 }}>{t('noRoles')}</p>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={theadRowStyle}>
                <th style={thStyle}>{t('colRole')}</th>
                <th style={thStyle}>{t('colMeasure')}</th>
                <th style={thStyle}>{t('colRatio')}</th>
                <th style={thStyle}>{t('colRuns')}</th>
                <th style={thStyle}>{t('colInterval')}</th>
                <th style={thStyle}>{t('colFlag')}</th>
              </tr>
            </thead>
            <tbody>
              {scores.flatMap((score) =>
                score.status === 'insufficient-data'
                  ? [
                      <tr key="insufficient" style={trStyle}>
                        <td style={tdStyle} colSpan={6}>{t('insufficientData', { count: score.finalRuns })}</td>
                      </tr>,
                    ]
                  : score.measures.map((m) => <MeasureRow key={`${score.status}-${m.id}`} measure={m} t={t} />),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MeasureRow({ measure, t }: { measure: ScoredMeasure; t: T }) {
  // One interval rule (§D14.4): the 95% posterior interval is drawn; the 99.8% funnel limit
  // is used only to call a point "outside limits".
  return (
    <tr style={trStyle}>
      <td style={tdStyle}>{t(`measure.${measure.id}`, { defaultValue: measure.id })}</td>
      <td style={tdStyle}>{measure.standardizedRatio != null ? measure.standardizedRatio.toFixed(2) : '—'}</td>
      <td style={tdStyle}>
        {measure.posteriorMean != null ? `${(measure.posteriorMean * 100).toFixed(0)}%` : '—'}
      </td>
      <td style={tdStyle}>{measure.finalRuns}</td>
      <td style={tdStyle}>
        {measure.posteriorInterval ? (
          <IntervalBar low={measure.posteriorInterval[0]} high={measure.posteriorInterval[1]} mean={measure.posteriorMean ?? 0} />
        ) : (
          '—'
        )}
      </td>
      <td style={tdStyle}>
        {measure.outsideLimits ? (
          <strong style={{ color: 'var(--error, #c0392b)' }}>{t('outsideLimits')}</strong>
        ) : (
          <span style={tdMutedStyle}>{t('withinLimits')}</span>
        )}
      </td>
    </tr>
  );
}

/** A horizontal bar drawn for the 95% interval, with the posterior mean marked. */
function IntervalBar({ low, high, mean }: { low: number; high: number; mean: number }) {
  // Clamp to a 0..1 display window; the interval can exceed 1 for a ratio measure.
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const left = clamp01(low) * 100;
  const width = Math.max(1, (clamp01(high) - clamp01(low)) * 100);
  const mark = clamp01(mean) * 100;
  return (
    <span
      role="img"
      aria-label={`${(low * 100).toFixed(0)}–${(high * 100).toFixed(0)}%`}
      style={{ position: 'relative', display: 'inline-block', width: 120, height: 10, verticalAlign: 'middle' }}
    >
      <span style={{ position: 'absolute', left: 0, top: 4, width: '100%', height: 2, background: 'var(--border-subtle)' }} />
      <span style={{ position: 'absolute', left: `${left}%`, top: 2, width: `${width}%`, height: 6, background: 'var(--accent, #4a7dff)', borderRadius: 2 }} />
      <span style={{ position: 'absolute', left: `${mark}%`, top: 0, width: 2, height: 10, background: 'var(--text-primary)' }} />
    </span>
  );
}
