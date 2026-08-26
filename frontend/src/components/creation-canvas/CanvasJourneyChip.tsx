'use client';

import { useTranslations } from 'next-intl';
import { methodStepKey } from '@/lib/methodology';
import { useFounderJourney } from '@/lib/useFounderJourney';

/**
 * Where this session sits on the founder's journey — a `journeyChip` slot
 * (status, not control, so it survives a collapsed bar). Reuses
 * `useFounderJourney()` rather than recomputing the position, and renders
 * nothing with no signal yet, so an empty board shows one fewer chip rather
 * than a chip naming nothing.
 */
export function CanvasJourneyChip() {
  const t = useTranslations('nav');
  const tMethod = useTranslations('methodology');
  const journey = useFounderJourney();

  if (!journey.stage) return null;

  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '5px 10px', borderRadius: 'var(--radius-full)',
        border: `1px solid var(--stage-${journey.stage})`,
        background: 'var(--bg-elevated)', color: 'var(--text-primary)',
        fontSize: 'var(--font-size-eyebrow)', fontWeight: 600, whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: `var(--stage-${journey.stage})` }} />
      {t(`stage.${journey.stage}`)}
      {journey.stage === 'idea' && journey.act && (
        <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
          · {tMethod(methodStepKey(journey.act, 'title'))}
        </span>
      )}
    </span>
  );
}
