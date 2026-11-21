import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { getTeamPeopleScores, type PersonScore, type PersonScoreEntry, type ScoredMeasure, type TeamPeopleScores } from '@/lib/personScores';
import { faultMessage } from '@/lib/apiClient';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import { LocalCollection } from '@/components/pm/LocalCollection';

/**
 * Workforce → Teams → People (PRD 41 §D14, WS22). The manager-facing view: per-contributor,
 * per-role quality scores derived deterministically from run-delta outcomes and WS16 labels,
 * risk-adjusted (observed ÷ expected) and shrunk toward the team. A ranked table is never the
 * default — the shared Collection opens in Card mode, one block per person, with the 95%
 * interval drawn and an "outside limits" flag (the only call-out, §D14.5). A score below the
 * 20-final-labelled-run minimum shows `insufficient-data`, never a number (§D14.4).
 *
 * Read-only and self-loading: the host (TeamDetailPanel) mounts it for the open team.
 */

type T = ReturnType<typeof useTranslations>;

const mutedStyle: CSSProperties = { fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' };

export function TeamPeopleView({ teamId }: { teamId: number }) {
  const t = useTranslations('workforce.teams.people');
  // One settled read per team: loading is "the last read is not for this team", so a
  // team switch shows the loading line again without a synchronous reset in the effect.
  const [read, setRead] = useState<{ teamId: number; data: TeamPeopleScores | null; error: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    getTeamPeopleScores(teamId).then(
      (data) => { if (live) setRead({ teamId, data, error: null }); },
      (e: unknown) => { if (live) setRead({ teamId, data: null, error: faultMessage(e, t('errLoad')) }); },
    );
    return () => { live = false; };
  }, [teamId, t]);

  const descriptor = useMemo(() => peopleDescriptor(t), [t]);

  const settled = read?.teamId === teamId ? read : null;
  const data = settled?.data ?? null;
  const error = settled?.error ?? null;

  if (settled == null) return <p style={mutedStyle}>{t('loading')}</p>;
  if (error) return <p style={{ ...mutedStyle, color: 'var(--error)' }}>{error}</p>;
  if (!data) return null;

  if (data.people.length === 0) {
    return <p style={mutedStyle}>{data.humanScoringEnabled ? t('empty') : t('emptyScoringOff')}</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ ...mutedStyle, margin: 0 }}>
        {t('lede', { days: data.windowDays })}
        {!data.humanScoringEnabled && <> {t('scoringOffNote')}</>}
      </p>
      <LocalCollection descriptor={descriptor} rows={data.people} searchText={(p) => p.displayName} />
    </div>
  );
}

/** The run-quality measure that orders people (from the first role with a score). */
function qualityMeasure(scores: PersonScore[]): ScoredMeasure | null {
  for (const s of scores) {
    if (s.status !== 'ok') continue;
    const q = s.measures.find((m) => m.id === 'run-quality');
    if (q?.posteriorMean != null) return q;
  }
  return null;
}

/** The run-quality posterior mean used for ordering (insufficient-data sorts last). */
const qualityOf = (p: PersonScoreEntry): number => qualityMeasure(p.scores)?.posteriorMean ?? -1;
const runsOf = (p: PersonScoreEntry): number => p.scores.reduce((n, s) => n + s.finalRuns, 0);
const flagsOf = (p: PersonScoreEntry): number =>
  p.scores.reduce((n, s) => n + (s.status === 'ok' ? s.measures.filter((m) => m.outsideLimits).length : 0), 0);
const percent = (v: number | null): string => (v != null ? `${(v * 100).toFixed(0)}%` : '—');

function peopleDescriptor(t: T): CollectionDescriptor<PersonScoreEntry> {
  const kind = (p: PersonScoreEntry) => t(`kind.${p.kind}`, { defaultValue: p.kind });
  const flag = (outside: boolean) =>
    outside ? <strong style={{ color: 'var(--error)' }}>{t('outsideLimits')}</strong> : <span style={mutedStyle}>{t('withinLimits')}</span>;
  return {
    entity: null,
    surfaceKey: 'workforce.teams.people',
    rowId: (p) => String(p.contributorId),
    label: (p) => p.displayName,
    // Sorted by the run-quality posterior mean, highest first — but as person blocks.
    defaultView: 'card',
    defaultSort: { key: 'quality', dir: 'desc' },
    emptyKey: 'empty',
    columns: [
      { key: 'person', header: t('colPerson'), compare: (a, b) => a.displayName.localeCompare(b.displayName), cell: (p) => <strong>{p.displayName}</strong> },
      { key: 'kind', header: t('colKind'), compare: (a, b) => a.kind.localeCompare(b.kind), cell: kind },
      { key: 'quality', header: t('measure.run-quality'), compare: (a, b) => qualityOf(a) - qualityOf(b), cell: (p) => percent(qualityMeasure(p.scores)?.posteriorMean ?? null) },
      {
        key: 'interval',
        header: t('colInterval'),
        cell: (p) => {
          const q = qualityMeasure(p.scores);
          return q?.posteriorInterval ? <IntervalBar low={q.posteriorInterval[0]} high={q.posteriorInterval[1]} mean={q.posteriorMean ?? 0} /> : '—';
        },
      },
      { key: 'runs', header: t('colRuns'), compare: (a, b) => runsOf(a) - runsOf(b), cell: runsOf },
      { key: 'flag', header: t('colFlag'), compare: (a, b) => flagsOf(a) - flagsOf(b), cell: (p) => flag(flagsOf(p) > 0) },
    ],
    card: (p) => (
      <section style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--font-size-body, 14px)', fontWeight: 600, color: 'var(--text-primary)' }}>{p.displayName}</h3>
          <span style={mutedStyle}>{kind(p)}</span>
        </header>
        {p.scores.length === 0 ? (
          <p style={{ ...mutedStyle, margin: 0 }}>{t('noRoles')}</p>
        ) : (
          p.scores.map((score, i) =>
            score.status === 'insufficient-data' ? (
              <p key={`insufficient-${i}`} style={{ ...mutedStyle, margin: 0 }}>{t('insufficientData', { count: score.finalRuns })}</p>
            ) : (
              score.measures.map((m) => <MeasureLine key={`${i}-${m.id}`} measure={m} t={t} flag={flag} />)
            ),
          )
        )}
      </section>
    ),
  };
}

function MeasureLine({ measure, t, flag }: { measure: ScoredMeasure; t: T; flag: (outside: boolean) => ReactNode }) {
  // One interval rule (§D14.4): the 95% posterior interval is drawn; the 99.8% funnel limit
  // is used only to call a point "outside limits".
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 'var(--font-size-small)' }}>
          {t(`measure.${measure.id}`, { defaultValue: measure.id })} · {percent(measure.posteriorMean)}
        </span>
        {flag(measure.outsideLimits)}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', ...mutedStyle }}>
        <span>{t('colRatio')}: {measure.standardizedRatio != null ? measure.standardizedRatio.toFixed(2) : '—'}</span>
        <span>{t('colRuns')}: {measure.finalRuns}</span>
        {measure.posteriorInterval && (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {t('colInterval')}
            <IntervalBar low={measure.posteriorInterval[0]} high={measure.posteriorInterval[1]} mean={measure.posteriorMean ?? 0} />
          </span>
        )}
      </div>
    </div>
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
      <span style={{ position: 'absolute', left: `${left}%`, top: 2, width: `${width}%`, height: 6, background: 'var(--accent)', borderRadius: 'var(--radius-full)' }} />
      <span style={{ position: 'absolute', left: `${mark}%`, top: 0, width: 2, height: 10, background: 'var(--text-primary)' }} />
    </span>
  );
}
