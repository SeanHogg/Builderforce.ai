/**
 * STAGEBAR (PRD 25 Slice D) — the ONE renderer for every milestone tile.
 *
 * Regulatory stage, development stage, production stage, reimbursement path: all
 * are `custom_kpis` with `unit: 'stage'`, whose value is a 0-based ordinal into an
 * ordered stage list carried as DATA on the metric. This component takes that
 * list and the ordinal and draws the path — no per-vertical branch.
 *
 * `current === null` is "not measured": the path is drawn muted with nothing
 * reached, never as stage 0.
 */

import { useTranslations } from 'next-intl';

export interface StageBarProps {
  /** Ordered stage ids; labels resolve under `components.stage.<id>`. */
  stages: readonly string[];
  /** 0-based ordinal of the current stage, or null when not measured. */
  current: number | null;
  ariaLabel: string;
}

export function StageBar({ stages, current, ariaLabel }: StageBarProps) {
  const t = useTranslations('components');
  const label = (id: string) => t(`stage.${id}` as 'stage.concept');
  const measured = current != null && current >= 0 && current < stages.length;

  return (
    <div role="group" aria-label={ariaLabel}>
      <ol style={{ display: 'flex', gap: 4, listStyle: 'none', margin: 0, padding: 0 }}>
        {stages.map((id, i) => {
          const reached = measured && i <= (current as number);
          const isCurrent = measured && i === current;
          return (
            <li
              key={id}
              aria-current={isCurrent ? 'step' : undefined}
              title={label(id)}
              style={{
                flex: 1,
                height: 8,
                borderRadius: 'var(--radius-sm)',
                background: reached ? 'var(--accent)' : 'var(--border-subtle)',
                opacity: isCurrent || !reached ? 1 : 0.55,
              }}
            />
          );
        })}
      </ol>
      <div style={{ marginTop: 8, fontSize: 'var(--font-size-small)', color: measured ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: measured ? 600 : 400 }}>
        {measured ? label(stages[current as number]!) : t('vertical.notMeasured')}
      </div>
    </div>
  );
}
