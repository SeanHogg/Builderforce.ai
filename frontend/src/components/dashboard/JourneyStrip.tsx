'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { METHOD_STAGES } from '@/lib/methodology';
import type { Stage } from '@/lib/navGroups';
import { useFounderJourney } from '@/lib/useFounderJourney';
import { useSampleWorkspace } from '@/domains/guest/presentation/useSampleWorkspace';
import styles from './JourneyStrip.module.css';

/**
 * The founder's journey, in one row: Idea → Make → Run → Measure. Self-gated
 * on `useFounderJourney()` — no `stage` prop drilled from the dashboard, so
 * this drops onto any other page unchanged the day one wants it.
 *
 * Two silhouettes, not two components: full-size until the strip scrolls past
 * its own bottom edge (an `IntersectionObserver` against a zero-height
 * sentinel), then a single sticky compact row — the same data, read once and
 * rendered twice, never two competing sources of "where am I".
 */
export function JourneyStrip() {
  const t = useTranslations('nav');
  const tMethod = useTranslations('methodology');
  const router = useRouter();
  const journey = useFounderJourney();
  const { isSample } = useSampleWorkspace();
  const [compact, setCompact] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // A guest previewing the product is always shown mid-idea — that is the
  // sample workspace's own posture — never the "no signal yet" empty state.
  const currentStage: Stage | null = journey.stage ?? (isSample ? 'idea' : null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setCompact(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.wrap}>
      <div className={styles.full} data-hidden={compact}>
        <ol className={styles.rail} aria-label={t('journey.label')}>
          {METHOD_STAGES.map((stage) => (
            <li key={stage} className={styles.cell} data-stage={stage} data-current={currentStage === stage}>
              <span className={styles.dot} aria-hidden="true" />
              <span className={styles.label}>{t(`stage.${stage}`)}</span>
              <span className={styles.tagline}>{tMethod(`arcQuestion.${stage}`)}</span>
            </li>
          ))}
        </ol>
      </div>
      <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />
      <div className={styles.compact} data-hidden={!compact} role="button" tabIndex={compact ? 0 : -1} onClick={() => router.push('/dashboard')}>
        {METHOD_STAGES.map((stage) => (
          <span key={stage} className={styles.compactCell} data-stage={stage} data-current={currentStage === stage}>
            <span className={styles.dot} aria-hidden="true" />
            {t(`stage.${stage}`)}
          </span>
        ))}
      </div>
    </div>
  );
}
