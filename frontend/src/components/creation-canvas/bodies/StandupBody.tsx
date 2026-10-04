import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { resourceIdOfType } from '@builderforce/creation-canvas-contract';
import { CeremonyOutcome } from '@/components/ceremony/CeremonyOutcome';
import type { CreationBodyProps } from './types';

/**
 * A stand-up card: who is seated, and — once it has actually been held — what came of it.
 *
 * The card used to show `data.summary` unconditionally, and `data.summary` on a convened
 * stand-up is the sentence stamped on at CONVENING time ("Brain will ask each person for
 * progress, blockers and next actions"). It survived the meeting unchanged, so the board
 * went on promising a stand-up that had already happened. Once a ceremony exists the
 * OUTCOME replaces it, read live from the ceremony and its companion meeting rather than
 * copied onto the card — attendance is correctable afterwards, and a copy is exactly what
 * a correction leaves behind.
 */
export function StandupBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const participants = Array.isArray(data.participants) ? data.participants as Array<Record<string, unknown>> : [];
  const ceremonyId = resourceIdOfType(data.resourceId, 'ceremony');
  return <div className={styles.standupBody}>
    <div className={styles.standupRoster}>{participants.length ? participants.map((person, index) => <span key={`${person.ref}-${index}`}><i>{String(person.name || '?').slice(0, 1)}</i><b>{String(person.name || t('participant'))}</b><small>{String(person.kind || t('human'))}</small></span>) : <p>{t('standupFallback')}</p>}</div>
    {ceremonyId
      // The outcome decides its own visibility: nothing at all while the stand-up is
      // still running, which is when the round table is the surface to be looking at.
      ? <div className={styles.standupSummary}><CeremonyOutcome ceremonyId={ceremonyId} showTranscript={false} /></div>
      : typeof data.summary === 'string' && <div className={styles.standupSummary}><b>{t('brainFacilitator')}</b><p>{data.summary}</p></div>}
  </div>;
}
