/**
 * A page's score (PRD 33 §5.2 "Measure"): the total and one ring per component of
 * `ReplayPageScoreDto` (`pageScore` over `PAGE_SCORE_WEIGHTS`). A component with no
 * data says so instead of drawing an empty ring as zero. The rings carry their
 * number as text, so the colour is never the only signal.
 */

import { useTranslations } from 'next-intl';
import type { ReplayPageScoreDto } from '@builderforce/interaction-contract';

/** The rings, in order — DATA. */
export const SCORE_COMPONENTS: ReadonlyArray<keyof ReplayPageScoreDto> = ['total', 'conversion', 'frustration', 'seo', 'performance', 'accessibility'];

export function scoreTone(score: number): string {
  if (score >= 80) return 'var(--success)';
  if (score >= 50) return 'var(--warning)';
  return 'var(--error)';
}

const R = 16;
const C = 2 * Math.PI * R;

function Ring({ label, value }: { label: string; value: number | null }) {
  const t = useTranslations('replay.page.score');
  const shown = value === null ? null : Math.max(0, Math.min(100, Math.round(value)));
  return (
    <figure
      data-testid="score-ring"
      aria-label={shown === null ? t('ringNone', { label }) : t('ringAria', { label, score: shown })}
      style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 64 }}
    >
      <svg width={44} height={44} viewBox="0 0 40 40" aria-hidden="true">
        <circle cx={20} cy={20} r={R} fill="none" stroke="var(--border)" strokeWidth={4} />
        {shown !== null && (
          <circle
            cx={20}
            cy={20}
            r={R}
            fill="none"
            stroke={scoreTone(shown)}
            strokeWidth={4}
            strokeDasharray={`${(shown / 100) * C} ${C}`}
            strokeLinecap="round"
            transform="rotate(-90 20 20)"
          />
        )}
        <text x={20} y={24} textAnchor="middle" fontSize={11} fill="var(--text-primary)">{shown ?? '—'}</text>
      </svg>
      <figcaption style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', textAlign: 'center' }}>{label}</figcaption>
    </figure>
  );
}

export function ScoreRings({ score }: { score: ReplayPageScoreDto | null }) {
  const t = useTranslations('replay.page.score');
  if (!score) return <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('none')}</p>;
  return (
    <div role="group" aria-label={t('title')} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
      {SCORE_COMPONENTS.map((part) => <Ring key={part} label={t(`part.${part}`)} value={score[part]} />)}
    </div>
  );
}
