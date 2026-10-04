import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { PITCH_MAX_SCORE, type PitchLabelled } from '@/lib/pitchCompetition';

/**
 * The pitch cards.
 *
 * Every one of them answers the only question that matters before the room:
 * "am I ready, and what is the next thing that would cost me the win". The
 * verdict leads — runtime against the limit, weighted readiness, rehearsal
 * coverage, whether the entry can actually be submitted — and the detail follows
 * it. Nothing here decides a rule; `pitchCompetition.ts` does, and these read it.
 */
export function PitchLabel({ item }: { item: PitchLabelled }) {
  const t = useTranslations('creationCanvas.pitch');
  return <>{item.labelKey && t.has(item.labelKey) ? t(item.labelKey) : item.label}</>;
}

export function PitchScoreRow({ score }: { score: number }) {
  return <span className={styles.pitchScore} aria-hidden>
    {Array.from({ length: PITCH_MAX_SCORE }, (_, index) => <i key={index} data-filled={index < score ? 'true' : 'false'} />)}
  </span>;
}
