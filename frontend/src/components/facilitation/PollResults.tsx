'use client';

/**
 * ONE drawing of a poll's answers, for every surface that shows them.
 *
 * ── WHY ONE COMPONENT ────────────────────────────────────────────────────────
 * The facilitator's board and the participant's phone show the SAME result at the same
 * moment — that is the entire point of a live poll, and a room watching two renderings
 * of one tally disagree about a percentage is the failure mode. So there is one
 * component, handed a `PollTally` the contract computed, and neither surface counts
 * anything.
 *
 * ── WHY THE COUNTED FORMATS REUSE `BarChart` ─────────────────────────────────
 * Choice, multi-choice, ranking, scale and a 2x2's quadrant shares are all "a labelled
 * category with a value", which is exactly what the project's category-ranking primitive
 * already draws. A second bar implementation here would be the duplication the DRY rule
 * forbids, and it would drift in the one way that matters: the palette.
 *
 * What is NOT a ranking of categories gets its own mark, because it genuinely is one: a
 * word cloud is a shape, a 2x2 is a position, and a Q&A is a list of what people said.
 * Each of those also writes its numbers out as text for a reader the shape does not
 * reach — a result nobody can read is not a result.
 */

import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { BarChart } from '@/components/charts/BarChart';
import { POLL_GRID_QUADRANTS, type PollGridAxes, type PollTally } from '@builderforce/creation-canvas-contract';
import styles from './PollResults.module.css';

/** The smallest and largest a cloud term is drawn, as a multiple of body size. A term
 *  below the floor is unreadable at any zoom; above the ceiling it pushes every other
 *  term off the surface, which loses the shape the cloud exists to show. */
const TERM_MIN_SCALE = 0.9;
const TERM_MAX_SCALE = 2.8;

export interface PollResultsProps {
  tally: PollTally;
  /** The 2x2's axes, when the poll has them. */
  grid?: PollGridAxes | null;
  /** How many people the facilitator expected — shown beside the count when known.
   *  Absent on the phone, where nobody knows the size of the room. */
  expected?: number | null;
}

export function PollResults({ tally, grid, expected }: PollResultsProps) {
  const t = useTranslations('poll');
  const fmt = useFormat();

  const summary = (
    <p className={styles.summary}>
      <span>{t('responseCount', { count: tally.responseCount })}</span>
      {expected != null && expected > 0 && <span>{t('ofExpected', { expected })}</span>}
      {tally.mean != null && <span>{t('mean', { mean: fmt.number(Math.round(tally.mean * 10) / 10) })}</span>}
      {/* A shape drawn from the first N of M answers is a different claim from one
          drawn from all of them, and a reader who is not told which will assume the
          second. */}
      {tally.truncated && <span>{t('truncated')}</span>}
    </p>
  );

  if (tally.responseCount === 0) {
    return (
      <div className={styles.results}>
        {summary}
        <p className={styles.empty}>{t('noAnswersYet')}</p>
      </div>
    );
  }

  return (
    <div className={styles.results}>
      {summary}
      {body()}
    </div>
  );

  function body() {
    switch (tally.format) {
      case 'openText':
        return (
          <ul className={styles.answers}>
            {tally.texts.map((text, index) => (
              <li key={`${index}-${text.slice(0, 24)}`} className={styles.answer}>{text}</li>
            ))}
          </ul>
        );

      case 'wordCloud': {
        const peak = Math.max(1, ...tally.entries.map((entry) => entry.value));
        return (
          <>
            <div className={styles.cloud} role="img" aria-label={t('cloudLabel', { terms: tally.entries.length })}>
              {tally.entries.map((entry) => {
                // Linear in the COUNT rather than in the share: a cloud is read by
                // comparing two words to each other, and a share is a comparison with
                // the total nobody is looking at.
                const scale = TERM_MIN_SCALE + (entry.value / peak) * (TERM_MAX_SCALE - TERM_MIN_SCALE);
                return (
                  <span
                    key={entry.key}
                    className={entry.value === peak ? styles.term : `${styles.term} ${styles.termQuiet}`}
                    style={{ '--term-scale': scale } as React.CSSProperties}
                    title={t('termCount', { term: entry.label, count: entry.value })}
                  >
                    {entry.label}
                  </span>
                );
              })}
            </div>
            <ul className={styles.visuallyHidden}>
              {tally.entries.map((entry) => (
                <li key={entry.key}>{t('termCount', { term: entry.label, count: entry.value })}</li>
              ))}
            </ul>
          </>
        );
      }

      case 'grid':
        return (
          <>
            <div className={styles.grid} role="img" aria-label={t('gridLabel', { count: tally.points.length })}>
              <span className={`${styles.gridAxis} ${styles.gridAxisX}`} aria-hidden />
              <span className={`${styles.gridAxis} ${styles.gridAxisY}`} aria-hidden />
              {grid?.xLabel && <span className={`${styles.gridLabel} ${styles.gridLabelX}`}>{grid.xLabel}</span>}
              {grid?.yLabel && <span className={`${styles.gridLabel} ${styles.gridLabelY}`}>{grid.yLabel}</span>}
              {tally.points.map((point, index) => (
                <span
                  key={index}
                  className={styles.gridPoint}
                  // `y` is inverted because a 2x2 reads upwards and CSS reads downwards.
                  style={{ left: `${point.x * 100}%`, top: `${(1 - point.y) * 100}%` }}
                  aria-hidden
                />
              ))}
            </div>
            <BarChart
              data={tally.entries.map((entry) => ({
                key: entry.key,
                label: t(`quadrant.${entry.key}` as 'quadrant.lowLow'),
                value: entry.value,
              }))}
              ariaLabel={t('quadrantShares')}
            />
          </>
        );

      default:
        return (
          <BarChart
            data={tally.entries.map((entry) => ({
              key: entry.key,
              // A quiz's right answer is named as such rather than coloured differently:
              // colour alone is not a distinction for every reader, and the one thing a
              // quiz result has to communicate is which bar was correct.
              label: entry.correct ? t('correctOption', { label: entry.label }) : entry.label,
              value: entry.value,
            }))}
            ariaLabel={t('resultsLabel')}
          />
        );
    }
  }
}

/** The quadrant keys, re-exported so a caller labelling a 2x2 does not re-derive them
 *  from the tally it was handed. */
export { POLL_GRID_QUADRANTS };
