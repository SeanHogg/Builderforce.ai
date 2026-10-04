import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { pitchCompetitionFor, pitchCriteria, pitchReadiness, pitchReadinessTone, pitchWeakestCriteria } from '@/lib/pitchCompetition';
import type { CreationBodyProps } from './types';
import { PitchLabel, PitchScoreRow } from './pitchParts';

export function PitchScorecardBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.pitch');
  const competition = pitchCompetitionFor(data);
  const criteria = pitchCriteria(data);
  const readiness = pitchReadiness(criteria);
  const weakest = pitchWeakestCriteria(criteria);
  return <div className={styles.pitchBody}>
    <div className={styles.pitchReadiness} data-tone={pitchReadinessTone(readiness)} style={{ '--pitch-readiness': readiness } as CSSProperties}>
      <div className={styles.pitchGauge}><strong>{readiness}%</strong><small>{t('ready')}</small></div>
      <div><small>{t('scoredAgainst')}</small><b>{competition.name}</b><p>{t('criteriaCount', { count: criteria.length })}</p></div>
      <span><b>{criteria.filter((criterion) => criterion.score > 0).length}/{criteria.length}</b><small>{t('scored')}</small></span>
    </div>
    <div className={styles.pitchCriteria}>
      {criteria.map((criterion) => <div key={criterion.id}>
        <b><PitchLabel item={criterion} /></b>
        <PitchScoreRow score={criterion.score} />
        <p>{criterion.evidence || criterion.prompt}</p>
        {criterion.gap && <small>{t('gapPrefix', { gap: criterion.gap })}</small>}
      </div>)}
    </div>
    {weakest.length > 0 && <p className={styles.pitchNextUp}>
      <b>{t('marksLostHere')}</b>
      {weakest.map((criterion) => <span key={criterion.id}><PitchLabel item={criterion} /></span>)}
    </p>}
  </div>;
}
