/*
 * No `'use client'` here on purpose: imported only by `CanvasIdeasSurface`.
 */
import { useTranslations } from 'next-intl';
import { IDEA_STAGES, type IdeaStage } from '@builderforce/creation-canvas-contract';
import styles from './CanvasIdeasSurface.module.css';

export type IdeaStageFilter = IdeaStage | 'all';

export interface IdeaStageBarProps {
  counts: Readonly<Record<IdeaStage, number>>;
  total: number;
  /** Open ideas that name no interview or experiment — see `untestedIdeaCount`. */
  untested: number;
  value: IdeaStageFilter;
  onChange: (value: IdeaStageFilter) => void;
}

/**
 * Where the ideas are, and the one number worth acting on.
 *
 * ── WHY THE DISTRIBUTION IS THE FILTER ───────────────────────────────────────────
 * A row of stage chips above a stage chart is two controls for one question. Each bar
 * here IS the filter for its stage (a pressed toggle), so reading "four are still just
 * captured" and pressing it to see which four are one gesture.
 *
 * ONE hue for every bar, because the job is magnitude, not identity — the stage is named
 * in text beside each bar and the count is printed at its end, so nothing is carried by
 * colour alone. The untested callout is the actionable half: an idea nobody has talked
 * to a customer about is the gap a scratchpad exists to close.
 */
export function IdeaStageBar({ counts, total, untested, value, onChange }: IdeaStageBarProps) {
  const t = useTranslations('creationCanvas.surface.ideas');
  const max = Math.max(1, ...IDEA_STAGES.map((stage) => counts[stage]));

  return (
    <section className={styles.stages} aria-label={t('bar.label')}>
      <p className={untested > 0 ? styles.untested : styles.allTested} role="status">
        <span aria-hidden className={styles.untestedMark}>{untested > 0 ? '!' : '✓'}</span>
        {t('bar.untested', { count: untested })}
      </p>
      <div className={styles.stageList} role="group" aria-label={t('filterLabel')}>
        <button
          type="button"
          className={styles.stageRow}
          aria-pressed={value === 'all'}
          onClick={() => onChange('all')}
        >
          <span className={styles.stageName}>{t('filterAll')}</span>
          <span className={styles.stageCount}>{total}</span>
        </button>
        {IDEA_STAGES.map((stage) => {
          const count = counts[stage];
          const label = t(`stage.${stage}`);
          return (
            <button
              key={stage}
              type="button"
              className={styles.stageRow}
              aria-pressed={value === stage}
              title={t('bar.segment', { stage: label, count })}
              onClick={() => onChange(value === stage ? 'all' : stage)}
            >
              <span className={styles.stageName}>{label}</span>
              <span className={styles.stageTrack} aria-hidden>
                {count > 0 && <span className={styles.stageFill} style={{ width: `${(count / max) * 100}%` }} />}
              </span>
              <span className={styles.stageCount}>{count}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
